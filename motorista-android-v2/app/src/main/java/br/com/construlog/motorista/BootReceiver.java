package br.com.construlog.motorista;

import android.content.*;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent){
        if(Prefs.token(context).isEmpty())return;
        Intent s=new Intent(context,TrackingService.class);
        if(Build.VERSION.SDK_INT>=26)context.startForegroundService(s); else context.startService(s);
    }
}
