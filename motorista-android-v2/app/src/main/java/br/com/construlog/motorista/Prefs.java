package br.com.construlog.motorista;

import android.content.Context;
import android.content.SharedPreferences;

public final class Prefs {
    private static SharedPreferences p(Context c){return c.getSharedPreferences("construlog_driver",Context.MODE_PRIVATE);}
    public static String token(Context c){return p(c).getString("token","");}
    public static String driver(Context c){return p(c).getString("driver","");}
    public static String plate(Context c){return p(c).getString("plate","");}
    public static String requestToken(Context c){return p(c).getString("request_token","");}
    public static void saveIdentity(Context c,String driver,String plate){p(c).edit().putString("driver",driver).putString("plate",plate).apply();}
    public static void saveRequest(Context c,String t){p(c).edit().putString("request_token",t).apply();}
    public static void saveToken(Context c,String t,String d,String plate){p(c).edit().putString("token",t).putString("driver",d).putString("plate",plate).remove("request_token").apply();}
}
