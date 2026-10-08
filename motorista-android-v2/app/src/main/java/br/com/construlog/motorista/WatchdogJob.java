package br.com.construlog.motorista;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;

public class WatchdogJob extends JobService {
    @Override public boolean onStartJob(final JobParameters params){
        Watchdog.scheduleAlarm(this,Watchdog.INTERVAL);
        Watchdog.kick(this,"tarefa",60000L,()->new Handler(Looper.getMainLooper()).post(()->{ try{jobFinished(params,false);}catch(Exception ignored){} }));
        return true;
    }
    @Override public boolean onStopJob(JobParameters params){
        return false;
    }
}
