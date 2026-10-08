package br.com.construlog.motorista;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class WatchdogReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent){
        Watchdog.scheduleAlarm(context,Watchdog.INTERVAL);
        Watchdog.scheduleJob(context);
        Watchdog.kickFromReceiver(context,"alarme",goAsync());
    }
}
