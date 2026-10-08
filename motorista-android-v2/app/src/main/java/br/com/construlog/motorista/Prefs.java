package br.com.construlog.motorista;

import android.content.Context;
import android.content.SharedPreferences;

public final class Prefs {
    private static SharedPreferences p(Context c){return c.getApplicationContext().getSharedPreferences("construlog_driver",Context.MODE_PRIVATE);}
    public static String token(Context c){return p(c).getString("token","");}
    public static String driver(Context c){return p(c).getString("driver","");}
    public static String plate(Context c){return p(c).getString("plate","");}
    public static String requestToken(Context c){return p(c).getString("request_token","");}
    public static void saveIdentity(Context c,String driver,String plate){p(c).edit().putString("driver",driver).putString("plate",plate).apply();}
    public static void saveRequest(Context c,String t){p(c).edit().putString("request_token",t).apply();}
    public static void saveToken(Context c,String t,String d,String plate){
        p(c).edit().putString("token",t).putString("driver",d).putString("plate",plate)
            .remove("request_token").putInt("auth_fail",0).putBoolean("auth_lost",false).commit();
    }

    // Este celular deixou de ser aceito pela central (401 repetido).
    public static boolean authLost(Context c){return p(c).getBoolean("auth_lost",false);}
    public static int authFail(Context c){return p(c).getInt("auth_fail",0);}
    public static void setAuthFail(Context c,int n){p(c).edit().putInt("auth_fail",n).putBoolean("auth_lost",n>=3).apply();}

    // Diagnóstico enviado à central.
    public static int restarts(Context c){return p(c).getInt("restarts",0);}
    public static void addRestart(Context c){p(c).edit().putInt("restarts",restarts(c)+1).apply();}
    public static String lastError(Context c){return p(c).getString("last_error","");}
    public static void setLastError(Context c,String e){p(c).edit().putString("last_error",e==null?"":e).apply();}
    public static long lastFixAt(Context c){return p(c).getLong("last_fix_at",0L);}
    public static void setLastFixAt(Context c,long t){p(c).edit().putLong("last_fix_at",t).apply();}
    public static boolean assigned(Context c){return p(c).getBoolean("assigned",false);}
    public static void setAssigned(Context c,boolean a){p(c).edit().putBoolean("assigned",a).apply();}

    // Versão publicada informada pelo servidor.
    public static int latestCode(Context c){return p(c).getInt("latest_code",0);}
    public static String latestUrl(Context c){return p(c).getString("latest_url","");}
    public static void setLatest(Context c,int code,String url){p(c).edit().putInt("latest_code",code).putString("latest_url",url==null?"":url).apply();}
    public static int updateNotified(Context c){return p(c).getInt("update_notified",0);}
    public static void setUpdateNotified(Context c,int code){p(c).edit().putInt("update_notified",code).apply();}

    // Primeira abertura: guia as permissões em sequência uma única vez.
    public static boolean guided(Context c){return p(c).getBoolean("guided",false);}
    public static void setGuided(Context c){p(c).edit().putBoolean("guided",true).apply();}
}
