package br.com.construlog.motorista;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent){
        // Celular ligou ou o aplicativo foi atualizado: religa o vigia e o rastreio.
        Watchdog.schedule(context);
        Watchdog.kickFromReceiver(context,"inicio",goAsync());
    }
}
