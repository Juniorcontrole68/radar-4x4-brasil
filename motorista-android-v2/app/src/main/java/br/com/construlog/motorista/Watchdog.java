package br.com.construlog.motorista;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Vigia: acorda o aplicativo de tempos em tempos para religar o rastreio caso o Android o
 * tenha fechado, e para buscar a liberação da central sem o motorista precisar abrir o app.
 * Usa dois mecanismos independentes (alarme e tarefa periódica) porque cada fabricante
 * respeita um deles de forma diferente.
 */
public final class Watchdog {
    static final long INTERVAL=5*60*1000L;
    private static final int ALARM_ID=7001, JOB_ID=7002;

    private Watchdog(){}

    static void schedule(Context c){
        scheduleAlarm(c,INTERVAL);
        scheduleJob(c);
    }

    static void scheduleAlarm(Context c,long delayMs){
        try{
            AlarmManager am=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi=PendingIntent.getBroadcast(c,ALARM_ID,new Intent(c,WatchdogReceiver.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            long at=SystemClock.elapsedRealtime()+delayMs;
            boolean exact=Build.VERSION.SDK_INT<31||am.canScheduleExactAlarms();
            try{
                if(exact)am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,at,pi);
                else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,at,pi);
            }catch(SecurityException e){
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,at,pi);
            }
        }catch(Exception ignored){}
    }

    static void scheduleJob(Context c){
        try{
            JobScheduler js=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if(js.getPendingJob(JOB_ID)!=null)return;
            JobInfo job=new JobInfo.Builder(JOB_ID,new ComponentName(c,WatchdogJob.class))
                .setPeriodic(15*60*1000L)
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
                .build();
            js.schedule(job);
        }catch(Exception ignored){}
    }

    /**
     * Garante que o rastreio está de pé. Se o serviço não puder subir (Android bloqueou o
     * início em segundo plano, ou ainda não há liberação), faz o mínimo por conta própria:
     * busca a liberação ou envia um sinal de vida com o diagnóstico.
     * done é chamado ao final (no máximo depois de limitMs).
     */
    static void kick(Context context,String why,long limitMs,Runnable done){
        final Context c=context.getApplicationContext();
        final AtomicBoolean finished=new AtomicBoolean(false);
        final Runnable finish=()->{ if(finished.compareAndSet(false,true)&&done!=null){ try{done.run();}catch(Exception ignored){} } };
        if(!Prefs.token(c).isEmpty()&&TrackingService.start(c,why)){ finish.run(); return; }
        if(Prefs.token(c).isEmpty()&&Prefs.requestToken(c).isEmpty()){ finish.run(); return; }
        new Handler(Looper.getMainLooper()).postDelayed(finish,limitMs);
        new Thread(()->{
            PowerManager.WakeLock w=null;
            try{
                w=((PowerManager)c.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"CONSTRULOG:vigia");
                w.acquire(45000L);
                if(Prefs.token(c).isEmpty()){
                    if(Backend.pollApproval(c))TrackingService.start(c,"liberado");
                }else{
                    Backend.heartbeat(c,TrackingService.running);
                }
            }catch(Throwable ignored){
            }finally{
                try{if(w!=null&&w.isHeld())w.release();}catch(Exception ignored){}
                finish.run();
            }
        },"construlog-vigia").start();
    }

    static void kickFromReceiver(Context c,String why,BroadcastReceiver.PendingResult pr){
        kick(c,why,8000L,()->{ if(pr!=null)pr.finish(); });
    }
}
