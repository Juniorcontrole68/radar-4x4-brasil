package br.com.construlog.motorista;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import org.json.JSONObject;

/** Retrato do celular: o que a central precisa saber para dizer por que o rastreio parou. */
public final class Health {
    private Health(){}

    private static boolean granted(Context c,String perm){
        return c.checkSelfPermission(perm)==PackageManager.PERMISSION_GRANTED;
    }
    public static boolean permLocation(Context c){
        return granted(c,Manifest.permission.ACCESS_FINE_LOCATION)||granted(c,Manifest.permission.ACCESS_COARSE_LOCATION);
    }
    public static boolean permBackground(Context c){
        return Build.VERSION.SDK_INT<29||granted(c,Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }
    public static boolean permNotifications(Context c){
        try{
            if(Build.VERSION.SDK_INT>=33&&!granted(c,Manifest.permission.POST_NOTIFICATIONS))return false;
            return ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled();
        }catch(Exception e){return true;}
    }
    public static boolean batteryUnrestricted(Context c){
        try{return ((PowerManager)c.getSystemService(Context.POWER_SERVICE)).isIgnoringBatteryOptimizations(c.getPackageName());}
        catch(Exception e){return true;}
    }
    public static boolean gpsOn(Context c){
        try{
            LocationManager lm=(LocationManager)c.getSystemService(Context.LOCATION_SERVICE);
            if(Build.VERSION.SDK_INT>=28&&!lm.isLocationEnabled())return false;
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)||lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        }catch(Exception e){return true;}
    }
    public static int batteryPct(Context c){
        try{
            int v=((BatteryManager)c.getSystemService(Context.BATTERY_SERVICE)).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return v>=0&&v<=100?v:-1;
        }catch(Exception e){return -1;}
    }
    private static boolean charging(Context c){
        try{return ((BatteryManager)c.getSystemService(Context.BATTERY_SERVICE)).isCharging();}
        catch(Exception e){return false;}
    }
    private static String net(Context c){
        try{
            ConnectivityManager cm=(ConnectivityManager)c.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities n=cm.getNetworkCapabilities(cm.getActiveNetwork());
            if(n==null)return "sem rede";
            if(n.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))return "wifi";
            if(n.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR))return "celular";
            return "outra";
        }catch(Exception e){return "";}
    }

    public static JSONObject report(Context c,boolean serviceRunning){
        JSONObject h=new JSONObject();
        try{
            h.put("perm_location",permLocation(c));
            h.put("perm_background",permBackground(c));
            h.put("perm_notifications",permNotifications(c));
            h.put("battery_unrestricted",batteryUnrestricted(c));
            h.put("gps_on",gpsOn(c));
            h.put("charging",charging(c));
            try{h.put("power_save",((PowerManager)c.getSystemService(Context.POWER_SERVICE)).isPowerSaveMode());}catch(Exception ignored){}
            if(Build.VERSION.SDK_INT>=31){
                try{h.put("exact_alarms",((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms());}catch(Exception ignored){}
            }
            int bat=batteryPct(c);
            if(bat>=0)h.put("battery_pct",bat);
            h.put("tracking",Prefs.assigned(c));
            h.put("service_running",serviceRunning);
            long fix=Prefs.lastFixAt(c);
            if(fix>0)h.put("last_fix_age_s",Math.max(0L,(System.currentTimeMillis()-fix)/1000L));
            h.put("queued_points",PointQueue.size(c));
            h.put("restarts",Prefs.restarts(c));
            h.put("android_sdk",Build.VERSION.SDK_INT);
            h.put("version_code",BuildConfig.VERSION_CODE);
            String n=net(c);if(!n.isEmpty())h.put("net",n);
            String err=Prefs.lastError(c);if(!err.isEmpty())h.put("last_error",err);
        }catch(Exception ignored){}
        return h;
    }
}
