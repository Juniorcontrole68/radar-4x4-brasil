package br.com.construlog.motorista;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

public final class Api {
    public static final String BASE = BuildConfig.API_BASE;

    /** Erro devolvido pelo servidor, com o código HTTP (401 = este celular não está mais liberado). */
    public static final class ApiException extends IOException {
        public final int code;
        ApiException(int code, String message){ super(message); this.code=code; }
    }

    private Api(){}

    public static JSONObject request(String method, String path, JSONObject body, String token) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(BASE+path).openConnection();
        try{
            c.setRequestMethod(method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            c.setRequestProperty("Accept","application/json");
            c.setRequestProperty("User-Agent","CONSTRULOG-Motorista/"+BuildConfig.VERSION_NAME);
            if(token!=null&&!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);
            if(body!=null){
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type","application/json; charset=utf-8");
                byte[] b=body.toString().getBytes(StandardCharsets.UTF_8);
                try(OutputStream o=c.getOutputStream()){o.write(b);}
            }
            int code=c.getResponseCode();
            InputStream in=(code>=200&&code<300)?c.getInputStream():c.getErrorStream();
            String text=read(in);
            JSONObject j;
            try{ j=text.isEmpty()?new JSONObject():new JSONObject(text); }
            catch(Exception notJson){ j=new JSONObject(); }
            if(code<200||code>=300)throw new ApiException(code,j.optString("error","HTTP "+code));
            return j;
        }finally{
            c.disconnect();
        }
    }

    public static String deviceName(){
        return android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL;
    }

    private static String read(InputStream in)throws IOException{
        if(in==null)return "";
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        byte[] b=new byte[4096]; int n;
        while((n=in.read(b))>0)out.write(b,0,n);
        return out.toString("UTF-8");
    }
}
