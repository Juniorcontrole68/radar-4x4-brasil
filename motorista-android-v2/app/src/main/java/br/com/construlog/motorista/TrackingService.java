package br.com.construlog.motorista;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class TrackingService extends Service implements LocationListener {
    static volatile boolean running=false;
    static volatile String statusText="";

    private ScheduledExecutorService exec;
    private LocationManager lm;
    private PowerManager.WakeLock wake, wakeShort;
    private volatile boolean assigned=false;
    private final AtomicBoolean updatesOn=new AtomicBoolean(false);
    private final Object flushLock=new Object();
    private volatile Location lastSent=null;
    private volatile long lastSentAt=0L, lastRearmAt=0L;

    /**
     * Liga o serviço. Devolve false quando ele não pode subir agora (sem liberação, sem
     * permissão de localização ou bloqueio do Android para início em segundo plano);
     * nesse caso o vigia envia apenas o sinal de vida.
     */
    static boolean start(Context c,String why){
        if(Prefs.token(c).isEmpty())return false;
        if(running){
            // Já está de pé: só pede uma rodada imediata.
            try{c.startService(new Intent(c,TrackingService.class).putExtra("why",why));return true;}
            catch(Exception ignored){}
        }
        if(!Health.permLocation(c)){Prefs.setLastError(c,"sem_permissao_localizacao");return false;}
        try{
            Intent i=new Intent(c,TrackingService.class).putExtra("why",why);
            if(Build.VERSION.SDK_INT>=26)c.startForegroundService(i);else c.startService(i);
            return true;
        }catch(Exception e){
            Prefs.setLastError(c,"inicio_bloqueado:"+e.getClass().getSimpleName());
            return false;
        }
    }

    @Override public void onCreate(){
        super.onCreate();
        running=true;
        Notifier.channels(this);
        PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
        wake=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"CONSTRULOG:GPS");
        wake.setReferenceCounted(false);
        wakeShort=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"CONSTRULOG:rodada");
        wakeShort.setReferenceCounted(false);
        lm=(LocationManager)getSystemService(LOCATION_SERVICE);
        if(!foreground("Iniciando rastreamento…")){stopSelf();return;}
        Prefs.addRestart(this);
        Prefs.setLastError(this,"");
        // Retoma o estado anterior até a primeira resposta do servidor: se o Android religou o
        // serviço no meio de uma rota sem internet, o GPS volta a gravar na hora.
        exec=Executors.newScheduledThreadPool(2);
        if(Prefs.assigned(this))exec.execute(()->safe(()->setAssigned(true)));
        exec.scheduleWithFixedDelay(()->safe(this::round),1,30,TimeUnit.SECONDS);
        exec.scheduleWithFixedDelay(()->safe(this::beat),6,60,TimeUnit.SECONDS);
        Watchdog.schedule(this);
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(exec==null){stopSelf();return START_NOT_STICKY;}
        foreground(statusText.isEmpty()?"Iniciando rastreamento…":statusText);
        try{wakeShort.acquire(40000L);}catch(Exception ignored){}
        String why=intent==null?"religado":String.valueOf(intent.getStringExtra("why"));
        if(!"aberto".equals(why))exec.execute(()->safe(()->{round();beat();}));
        else exec.execute(()->safe(this::round));
        Watchdog.schedule(this);
        return START_STICKY;
    }

    private boolean foreground(String text){
        statusText=text;
        try{
            if(Build.VERSION.SDK_INT>=29)startForeground(Notifier.ID_TRACKING,Notifier.tracking(this,text),ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(Notifier.ID_TRACKING,Notifier.tracking(this,text));
            return true;
        }catch(Exception e){
            Prefs.setLastError(this,"servico_localizacao:"+e.getClass().getSimpleName());
            // Android 14+: sem "Permitir o tempo todo" o serviço de localização não sobe em segundo
            // plano. Sobe no modo reduzido para a central ao menos saber o que falta no celular.
            if(Build.VERSION.SDK_INT>=34){
                try{
                    startForeground(Notifier.ID_TRACKING,Notifier.tracking(this,text),ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                    return true;
                }catch(Exception e2){
                    Prefs.setLastError(this,"servico_bloqueado:"+e2.getClass().getSimpleName());
                }
            }
            return false;
        }
    }

    private void safe(Runnable r){
        try{r.run();}
        catch(Throwable t){Prefs.setLastError(this,"erro:"+t.getClass().getSimpleName());}
    }

    /** A cada 30 s: confere o romaneio, religa o GPS se preciso e envia o que estiver na fila. */
    private void round(){
        String token=Prefs.token(this);
        if(token.isEmpty()){stopSelf();return;}
        checkAssignment(token);
        if(assigned)rearmGps();
        flush();
        refreshNotification();
    }

    private void beat(){
        Backend.heartbeat(this,true);
        refreshNotification();
    }

    private void checkAssignment(String token){
        try{
            JSONObject j=Api.request("GET","/api/tracking/assignment/current",null,token);
            Backend.authOk(this);
            setAssigned(!j.isNull("assignment")&&j.optJSONObject("assignment")!=null);
        }catch(Api.ApiException e){
            if(e.code==401)Backend.authDenied(this);
        }catch(Exception e){
            // Sem internet: mantém o estado atual e continua gravando as posições na fila.
        }
    }

    private void setAssigned(boolean a){
        assigned=a;
        if(Prefs.assigned(this)!=a)Prefs.setAssigned(this,a);
        if(a){
            try{if(!wake.isHeld())wake.acquire();}catch(Exception ignored){}
            startLocation();
        }else{
            stopLocation();
            lastSent=null;
            try{if(wake.isHeld())wake.release();}catch(Exception ignored){}
        }
    }

    private void startLocation(){
        if(updatesOn.get())return;
        if(!Health.permLocation(this))return;
        try{
            boolean any=false;
            if(lm.isProviderEnabled(LocationManager.GPS_PROVIDER)){
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,10000L,0f,this,Looper.getMainLooper());any=true;
            }
            if(lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)){
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,20000L,0f,this,Looper.getMainLooper());any=true;
            }
            updatesOn.set(any);
            lastRearmAt=System.currentTimeMillis();
            Location last=lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if(last==null)last=lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if(last!=null&&System.currentTimeMillis()-last.getTime()<5*60*1000L)onLocationChanged(last);
        }catch(Exception e){
            Prefs.setLastError(this,"gps:"+e.getClass().getSimpleName());
        }
    }

    private void stopLocation(){
        if(!updatesOn.getAndSet(false))return;
        try{lm.removeUpdates(this);}catch(Exception ignored){}
    }

    /** Sem posição nova há mais de 3 minutos em rota: registra o GPS de novo (alguns celulares param de entregar). */
    private void rearmGps(){
        long now=System.currentTimeMillis();
        if(!updatesOn.get()){startLocation();return;}
        if(now-Prefs.lastFixAt(this)>180000L&&now-lastRearmAt>180000L){
            stopLocation();
            startLocation();
        }
    }

    @Override public void onLocationChanged(Location l){
        if(l==null||!assigned)return;
        long now=System.currentTimeMillis();
        Prefs.setLastFixAt(this,now);
        Location prev=lastSent;
        long since=now-lastSentAt;
        if(prev!=null){
            boolean gps=LocationManager.GPS_PROVIDER.equals(l.getProvider());
            if(!gps&&l.hasAccuracy()&&l.getAccuracy()>150f&&since<120000L)return; // rede imprecisa com GPS recente
            if(since<8000L)return;                                              // dois provedores ao mesmo tempo
            if(prev.distanceTo(l)<15f&&since<120000L)return;                    // parado: uma posição a cada 2 min
        }
        lastSent=l;lastSentAt=now;
        try{
            JSONObject b=new JSONObject();
            b.put("latitude",l.getLatitude());
            b.put("longitude",l.getLongitude());
            if(l.hasAccuracy())b.put("accuracy_m",l.getAccuracy());
            if(l.hasSpeed())b.put("speed_mps",l.getSpeed());
            if(l.hasBearing())b.put("bearing_deg",l.getBearing());
            int bat=Health.batteryPct(this);
            if(bat>=0)b.put("battery_pct",bat);
            long t=l.getTime()>0?l.getTime():now;
            b.put("captured_at",new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX",Locale.US).format(new Date(t)));
            PointQueue.add(this,b);
        }catch(Exception ignored){}
        ScheduledExecutorService e=exec;
        if(e!=null&&!e.isShutdown()){
            try{e.execute(()->safe(()->{flush();refreshNotification();}));}catch(Exception ignored){}
        }
    }

    /** Envia a fila em lotes. Sem internet, as posições ficam guardadas para a próxima rodada. */
    private void flush(){
        synchronized(flushLock){
            String token=Prefs.token(this);
            if(token.isEmpty())return;
            for(int i=0;i<10;i++){
                List<String> batch=PointQueue.peek(this,100);
                if(batch.isEmpty())return;
                JSONArray arr=new JSONArray();
                for(String s:batch){
                    try{arr.put(new JSONObject(s));}catch(Exception ignored){}
                }
                if(arr.length()==0){PointQueue.drop(this,batch.size());continue;}
                try{
                    Api.request("POST","/api/tracking/points",new JSONObject().put("points",arr),token);
                    Backend.authOk(this);
                    PointQueue.drop(this,batch.size());
                }catch(Api.ApiException e){
                    if(e.code==409||e.code==400||e.code==413){PointQueue.drop(this,batch.size());continue;} // rota encerrada ou lote recusado
                    if(e.code==401)Backend.authDenied(this);
                    return;
                }catch(Exception e){
                    return;
                }
            }
        }
    }

    private void refreshNotification(){
        String t;
        long now=System.currentTimeMillis();
        if(Prefs.authLost(this))t="Este celular precisa ser reativado. Toque aqui.";
        else if(!Health.permLocation(this))t="Falta permitir a localização. Toque aqui.";
        else if(!Health.permBackground(this))t="Localização só com o app aberto. Toque aqui e escolha \"Permitir o tempo todo\".";
        else if(!Health.gpsOn(this))t="Localização (GPS) desligada. Ligue para rastrear.";
        else if(!assigned)t="Tudo certo • aguardando romaneio";
        else{
            int q=PointQueue.size(this);
            long fix=Prefs.lastFixAt(this);
            if(q>3)t="Sem internet • "+q+" posições guardadas para enviar";
            else if(fix>0&&now-fix<180000L)t="Rastreando • última posição às "+new SimpleDateFormat("HH:mm",Locale.US).format(new Date(fix));
            else t="Rastreando • procurando sinal de GPS";
        }
        if(!t.equals(statusText)){
            statusText=t;
            Notifier.showTracking(this,t);
        }
    }

    @Override public void onTaskRemoved(Intent rootIntent){
        // Motorista fechou o app na lista de recentes: em alguns celulares isso derruba o serviço.
        Watchdog.scheduleAlarm(this,5000L);
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy(){
        running=false;
        try{stopLocation();}catch(Exception ignored){}
        try{if(exec!=null)exec.shutdownNow();}catch(Exception ignored){}
        try{if(wake!=null&&wake.isHeld())wake.release();}catch(Exception ignored){}
        try{if(wakeShort!=null&&wakeShort.isHeld())wakeShort.release();}catch(Exception ignored){}
        // Se foi o Android que derrubou (e não a falta de liberação), o vigia religa em 1 minuto.
        if(exec!=null&&!Prefs.token(this).isEmpty())Watchdog.scheduleAlarm(this,60000L);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onProviderEnabled(String p){
        ScheduledExecutorService e=exec;
        if(e!=null&&!e.isShutdown()){try{e.execute(()->safe(this::round));}catch(Exception ignored){}}
    }
    @Override public void onProviderDisabled(String p){
        ScheduledExecutorService e=exec;
        if(e!=null&&!e.isShutdown()){try{e.execute(()->safe(this::refreshNotification));}catch(Exception ignored){}}
    }
    @Override public void onStatusChanged(String p,int s,Bundle b){}
}
