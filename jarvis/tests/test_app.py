import unittest, tempfile, os, sys, threading, json
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(); server.DB=cls.tmp.name+'/test.sqlite3'; server.init_db()
        cls.env=patch.dict(os.environ,{'APP_PASSWORD':'senha-de-teste-123','GOOGLE_CLIENT_ID':'test-client','GOOGLE_CLIENT_SECRET':'test-secret','OPENAI_API_KEY':''});cls.env.start()
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls): cls.http.shutdown();cls.http.server_close();cls.env.stop();cls.tmp.cleanup()
    def request(self,path,method='GET',body=None,csrf=True,cookie=True):
        headers={}
        if cookie and getattr(self,'cookie',None):headers['Cookie']=self.cookie
        if csrf and getattr(self,'csrf',None):headers['X-CSRF-Token']=self.csrf
        payload=None if body is None else json.dumps(body).encode()
        headers['Content-Type']='application/json'
        try:
            with urlopen(Request(self.base+path,data=payload,method=method,headers=headers)) as r:
                raw=r.read();return r.status,json.loads(raw),r.headers
        except HTTPError as e:return e.code,json.loads(e.read()),e.headers
    def setUp(self):
        with server.db() as c:c.executescript('DELETE FROM tasks; DELETE FROM memories; DELETE FROM settings;')
        server.FAILURES.clear()
        code,d,h=self.request('/api/login','POST',{'password':'senha-de-teste-123'},cookie=False)
        self.assertEqual(code,200);self.cookie=h['Set-Cookie'].split(';')[0]
        self.csrf=self.request('/api/state')[1]['csrf']
    def test_auth_required(self):self.assertEqual(self.request('/api/state',cookie=False)[0],401)
    def test_wrong_password(self):self.assertEqual(self.request('/api/login','POST',{'password':'wrong'},cookie=False)[0],401)
    def test_csrf_required(self):self.assertEqual(self.request('/api/tasks','POST',{'title':'X'},csrf=False)[0],403)
    def test_task_persistence_and_complete(self):
        self.assertEqual(self.request('/api/tasks','POST',{'title':'Pagar conta','due':'2026-10-13T15:00'})[0],201)
        t=self.request('/api/state')[1]['tasks'][0];self.assertTrue(t['due'].endswith('-03:00'))
        self.assertEqual(self.request('/api/tasks/'+str(t['id']),'PATCH',{'done':True})[0],200)
        with server.db() as c:self.assertEqual(c.execute('SELECT done FROM tasks').fetchone()[0],1)
    def test_task_invalid_date_no_write(self):
        self.assertEqual(self.request('/api/tasks','POST',{'title':'Conta','due':'terça à tarde'})[0],400)
        self.assertEqual(self.request('/api/state')[1]['tasks'],[])
    def test_delete_confirmation(self):
        self.request('/api/tasks','POST',{'title':'X'});tid=self.request('/api/state')[1]['tasks'][0]['id']
        self.assertEqual(self.request('/api/tasks/'+str(tid),'DELETE',{})[0],400)
        self.assertEqual(self.request('/api/tasks/'+str(tid),'DELETE',{'confirmed':True})[0],200)
    def test_memory_opt_in_edit_delete(self):
        self.assertEqual(self.request('/api/memory','POST',{'title':'Meu nome'})[0],400)
        self.request('/api/memory','POST',{'enabled':True});self.request('/api/memory','POST',{'title':'Junior'})
        mid=self.request('/api/state')[1]['memories'][0]['id']
        self.assertEqual(self.request('/api/memory/'+str(mid),'PATCH',{'title':'Chefe'})[0],200)
        self.request('/api/memory','POST',{'enabled':False})
        self.assertFalse(self.request('/api/state')[1]['memory_enabled'])
        self.assertEqual(self.request('/api/memory/'+str(mid),'DELETE',{'confirmed':True})[0],200)
    def event(self,**kwargs):return {'title':'Reunião','start':'2026-10-13T14:00','end':'2026-10-13T15:00','guests':[],**kwargs}
    def test_calendar_disconnected(self):self.assertEqual(self.request('/api/events?date=2026-10-13')[0],409)
    def test_event_end_validation(self):self.assertEqual(self.request('/api/events','POST',self.event(end='2026-10-13T13:00'))[0],400)
    def test_no_guest_invitation_without_consent(self):
        self.assertEqual(self.request('/api/events','POST',self.event(guests=['a@example.com']))[0],400)
    def test_personal_event_no_invitation(self):
        with patch.object(server,'conflicts',return_value=[]),patch.object(server,'calendar',return_value={'id':'saved'}) as mock:
            self.assertEqual(self.request('/api/events','POST',self.event())[0],201)
            self.assertEqual(mock.call_args.kwargs['params']['sendUpdates'],'none')
            self.assertEqual(mock.call_args.kwargs['body']['attendees'],[])
    def test_explicit_invitation(self):
        with patch.object(server,'conflicts',return_value=[]),patch.object(server,'calendar',return_value={'id':'saved'}) as mock:
            self.assertEqual(self.request('/api/events','POST',self.event(guests=['a@example.com'],invite_confirmed=True))[0],201)
            self.assertEqual(mock.call_args.kwargs['params']['sendUpdates'],'all')
    def test_conflict_never_writes(self):
        with patch.object(server,'conflicts',return_value=[{'id':'other'}]),patch.object(server,'calendar') as mock:
            self.assertEqual(self.request('/api/events','POST',self.event())[0],409);mock.assert_not_called()
    def test_google_failure_is_not_success(self):
        with patch.object(server,'conflicts',return_value=[]),patch.object(server,'calendar',side_effect=server.Problem('Google indisponível',502)):
            self.assertEqual(self.request('/api/events','POST',self.event())[0],502)
    def test_edit_preserves_guests_and_etag(self):
        old={'id':'event','etag':'version','attendees':[{'email':'a@example.com'}]}
        with patch.object(server,'conflicts',return_value=[]),patch.object(server,'calendar',side_effect=[old,{'id':'event'}]) as mock:
            self.assertEqual(self.request('/api/events/event','PATCH',self.event(invite_confirmed=True))[0],200)
            args=mock.call_args.args;self.assertNotIn('attendees',args[3]);self.assertEqual(args[-1],'version')
    def test_recurring_delete_blocked(self):
        with patch.object(server,'calendar',return_value={'id':'event','recurringEventId':'series'}) as mock:
            self.assertEqual(self.request('/api/events/event','DELETE',{'confirmed':True})[0],400);self.assertEqual(mock.call_count,1)
    def test_oauth_invalid_state(self):
        with patch.object(server,'remote') as mock:
            self.assertEqual(self.request('/oauth/callback?state=bad&code=fake')[0],403);mock.assert_not_called()
    def test_file_requires_consent(self):self.assertEqual(self.request('/api/file','POST',{'name':'a.txt','data':'aGk='})[0],400)
    def test_file_text_no_persistence(self):
        code,d,_=self.request('/api/file','POST',{'name':'a.txt','data':'aGk=','consent':True});self.assertEqual(code,200);self.assertEqual(d['text'],'hi')
    def test_search_unconfigured(self):
        with patch.dict(os.environ,{'BRAVE_API_KEY':''}):self.assertEqual(self.request('/api/search','POST',{'query':'x'})[0],409)
    def test_chat_no_false_execution(self):
        code,d,_=self.request('/api/chat','POST',{'message':'marque reunião com Alessandro terça à tarde'})
        self.assertEqual(code,200);self.assertEqual(d['action'],'agenda');self.assertNotIn('marcada',d['reply'])
    def test_tomorrow_uses_real_consult(self):
        d=self.request('/api/chat','POST',{'message':'mostre meus compromissos de amanhã'})[1]
        self.assertEqual(d['action'],'agenda');self.assertIn('date',d)
    def test_logout_invalidates_session(self):
        self.request('/api/logout','POST',{});self.assertEqual(self.request('/api/state')[0],401)

if __name__=='__main__':unittest.main()
