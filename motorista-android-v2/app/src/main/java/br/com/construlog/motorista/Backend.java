package br.com.construlog.motorista;

import android.content.Context;
import org.json.JSONObject;

/** Chamadas ao servidor usadas tanto pelo serviço de rastreio quanto pelo vigia. */
public final class Backend {
    private Backend(){}

    static void authOk(Context c){
        if(Prefs.authFail(c)!=0)Prefs.setAuthFail(c,0);
    }
    static void authDenied(Context c){
        Prefs.setAuthFail(c,Math.min(1000,Prefs.authFail(c)+1));
    }

    /** Sinal de vida com o diagnóstico do celular. Devolve true quando o servidor respondeu. */
    static boolean heartbeat(Context c,boolean serviceRunning){
        String token=Prefs.token(c);
        if(token.isEmpty())return false;
        try{
            JSONObject b=new JSONObject();
            b.put("app_version",BuildConfig.VERSION_NAME);
            b.put("health",Health.report(c,serviceRunning));
            JSONObject j=Api.request("POST","/api/tracking/heartbeat",b,token);
            authOk(c);
            int latest=j.optInt("latest_version_code",0);
            if(latest>0&&(latest!=Prefs.latestCode(c)||!j.optString("apk_url","").equals(Prefs.latestUrl(c))))
                Prefs.setLatest(c,latest,j.optString("apk_url",""));
            Notifier.maybeUpdate(c);
            return true;
        }catch(Api.ApiException e){
            if(e.code==401)authDenied(c);
            return false;
        }catch(Exception e){
            return false;
        }
    }

    /** Consulta se a central já liberou este celular. Devolve true no momento em que libera. */
    static boolean pollApproval(Context c){
        String rq=Prefs.requestToken(c);
        if(rq.isEmpty()||!Prefs.token(c).isEmpty())return false;
        try{
            JSONObject j=Api.request("GET","/api/tracking/register-status?request_token="+java.net.URLEncoder.encode(rq,"UTF-8"),null,null);
            if("approved".equals(j.optString("status"))&&!j.optString("token").isEmpty()){
                Prefs.saveToken(c,j.optString("token"),j.optString("driver_name",Prefs.driver(c)),j.optString("vehicle_plate",Prefs.plate(c)));
                return true;
            }
        }catch(Exception ignored){}
        return false;
    }
}
