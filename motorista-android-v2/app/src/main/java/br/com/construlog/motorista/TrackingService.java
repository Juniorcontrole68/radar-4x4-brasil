package br.com.construlog.motorista;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import org.json.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class TrackingService extends Service implements LocationListener {
    private static final String CH="construlog_tracking";
    private final ScheduledExecutorService exec=Executors.newScheduledThreadPool(2);
    private LocationManager lm;
    private PowerManager.WakeLock wake;
    private volatile boolean assigned=false;
    private volatile String sessionId="";
    private final AtomicBoolean updatesOn=new AtomicBoolean(false);

    @Override public void onCreate(){
        super.onCreate();
        createChannel();
        startForeground(1201,notification("Iniciando rastreamento…"));
        PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
        wake=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"CONSTRULOG:GPS");
        ensureWakeLock();
        lm=(LocationManager)getSystemService(LOCATION_SERVICE);
        exec.scheduleWithFixedDelay(this::checkAssignment,0,30,TimeUnit.SECONDS);
        exec.scheduleWithFixedDelay(this::heartbeat,5,60,TimeUnit.SECONDS);
    }

    private void ensureWakeLock(){
        try{
            if(wake!=null&&!wake.isHeld())wake.acquire();
        }catch(Exception ignored){}
    }

    private void checkAssignment(){
        ensureWakeLock();
        String token=Prefs.token(this);if(token.isEmpty())return;
        try{
            JSONObject j=Api.request("GET","/api/tracking/assignment/current",null,token);
            assigned=!j.isNull("assignment")&&j.optJSONObject("assignment")!=null;
            if(assigned){
                startLocation();
                updateNotification("Rastreamento ativo • aguardando posição");
            }else{
                sessionId="";
                stopLocation();
                updateNotification("Aguardando novo romaneio");
            }
        }catch(Exception e){
            updateNotification("Sem comunicação • tentando novamente");
        }
    }

    private void startLocation(){
        if(updatesOn.get())return;
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED &&
           checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            updateNotification("Permissão de localização necessária");
            return;
        }
        try{
            if(lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,12000,15,this,Looper.getMainLooper());
            if(lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,15000,30,this,Looper.getMainLooper());
            updatesOn.set(true);
            Location last=lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if(last==null)last=lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if(last!=null&&System.currentTimeMillis()-last.getTime()<10*60*1000L)sendPoint(last);
        }catch(Exception e){updateNotification("GPS indisponível • verifique permissões");}
    }

    private void stopLocation(){
        if(!updatesOn.getAndSet(false))return;
        try{lm.removeUpdates(this);}catch(Exception ignored){}
    }

    private void heartbeat(){
        ensureWakeLock();
        String token=Prefs.token(this);if(token.isEmpty())return;
        try{
            JSONObject b=new JSONObject();if(!sessionId.isEmpty())b.put("session_id",sessionId);
            JSONObject j=Api.request("POST","/api/tracking/heartbeat",b,token);
            if(!j.optString("session_id").isEmpty())sessionId=j.optString("session_id");
        }catch(Exception ignored){}
    }

    @Override public void onLocationChanged(Location l){
        if(!assigned)return;
        sendPoint(l);
    }

    private void sendPoint(Location l){
        exec.execute(()->{
            try{
                JSONObject b=new JSONObject();
                if(!sessionId.isEmpty())b.put("session_id",sessionId);
                b.put("latitude",l.getLatitude());
                b.put("longitude",l.getLongitude());
                if(l.hasAccuracy())b.put("accuracy_m",l.getAccuracy());
                if(l.hasSpeed())b.put("speed_mps",l.getSpeed());
                if(l.hasBearing())b.put("bearing_deg",l.getBearing());
                b.put("captured_at",new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX",java.util.Locale.US).format(new java.util.Date(l.getTime())));
                JSONObject j=Api.request("POST","/api/tracking/point",b,Prefs.token(this));
                if(!j.optString("session_id").isEmpty())sessionId=j.optString("session_id");
                if(j.optBoolean("ignored",false))updateNotification("GPS recebido • posição inválida descartada");
                else updateNotification("Rastreamento ativo • posição enviada");
            }catch(Exception e){updateNotification("GPS capturado • aguardando internet");}
        });
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        ensureWakeLock();
        checkAssignment();
        return START_STICKY;
    }

    private void createChannel(){
        if(Build.VERSION.SDK_INT>=26){
            NotificationChannel c=new NotificationChannel(CH,"CONSTRULOG Motorista",NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Rastreamento da rota do motorista");
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
        }
    }

    private Notification notification(String text){
        Intent open=new Intent(this,MainActivity.class);
        PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CH):new Notification.Builder(this);
        return b.setContentTitle("CONSTRULOG • "+(Prefs.driver(this).isEmpty()?"Motorista":Prefs.driver(this)))
                .setContentText(text).setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true).setContentIntent(pi).build();
    }

    private void updateNotification(String text){
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(1201,notification(text));
    }

    @Override public void onDestroy(){
        stopLocation();
        exec.shutdownNow();
        try{if(wake!=null&&wake.isHeld())wake.release();}catch(Exception ignored){}
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onProviderEnabled(String p){}
    @Override public void onProviderDisabled(String p){updateNotification("GPS desligado");}
    @Override public void onStatusChanged(String p,int s,Bundle b){}
}
