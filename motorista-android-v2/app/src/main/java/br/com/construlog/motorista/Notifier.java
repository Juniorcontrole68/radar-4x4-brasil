package br.com.construlog.motorista;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

public final class Notifier {
    static final String CH="construlog_tracking";
    static final String CH_ALERT="construlog_avisos";
    static final int ID_TRACKING=1201, ID_UPDATE=1202;

    private Notifier(){}

    static void channels(Context c){
        if(Build.VERSION.SDK_INT<26)return;
        NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel a=new NotificationChannel(CH,"Rastreamento",NotificationManager.IMPORTANCE_LOW);
        a.setDescription("Rastreamento da rota do motorista");
        nm.createNotificationChannel(a);
        NotificationChannel b=new NotificationChannel(CH_ALERT,"Avisos",NotificationManager.IMPORTANCE_DEFAULT);
        b.setDescription("Avisos de atualização e de reativação");
        nm.createNotificationChannel(b);
    }

    static Notification tracking(Context c,String text){
        Intent open=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(c,CH):new Notification.Builder(c);
        String who=Prefs.driver(c);
        b.setContentTitle("CONSTRULOG • "+(who.isEmpty()?"Motorista":who))
         .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
         .setSmallIcon(android.R.drawable.ic_menu_mylocation)
         .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(pi);
        if(Build.VERSION.SDK_INT>=31)b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    static void showTracking(Context c,String text){
        try{((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID_TRACKING,tracking(c,text));}
        catch(Exception ignored){}
    }

    /** Avisa uma vez por versão que há atualização publicada. */
    static void maybeUpdate(Context c){
        int latest=Prefs.latestCode(c);
        if(latest<=BuildConfig.VERSION_CODE||Prefs.updateNotified(c)>=latest)return;
        try{
            Intent view=new Intent(Intent.ACTION_VIEW,Uri.parse(updateUrl()));
            PendingIntent pi=PendingIntent.getActivity(c,1,view,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(c,CH_ALERT):new Notification.Builder(c);
            String text="Há uma versão nova do aplicativo. Toque aqui para instalar.";
            b.setContentTitle("CONSTRULOG Motorista • atualização")
             .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
             .setSmallIcon(android.R.drawable.stat_sys_download_done)
             .setAutoCancel(true).setContentIntent(pi);
            ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID_UPDATE,b.build());
            Prefs.setUpdateNotified(c,latest);
        }catch(Exception ignored){}
    }

    static String updateUrl(){
        return Api.BASE+"/motorista-instalar?atualizar=1";
    }
}
