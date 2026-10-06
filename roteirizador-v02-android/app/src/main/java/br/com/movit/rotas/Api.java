package br.com.movit.rotas;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

public final class Api {
    public static final String BASE="https://controle-coletas-jr.onrender.com";
    private Api(){}

    public static JSONObject get(String path)throws Exception{return request("GET",path,null,null);}
    public static JSONObject post(String path,JSONObject body)throws Exception{return request("POST",path,body,null);}
    public static JSONObject getAuth(String path,String token)throws Exception{return request("GET",path,null,token);}
    public static JSONObject postAuth(String path,JSONObject body,String token)throws Exception{return request("POST",path,body,token);}
    public static JSONObject deleteAuth(String path,String token)throws Exception{return request("DELETE",path,null,token);}

    private static JSONObject request(String method,String path,JSONObject body,String token)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(BASE+path).openConnection();
        c.setRequestMethod(method);c.setConnectTimeout(15000);c.setReadTimeout(25000);
        c.setRequestProperty("Accept","application/json");
        if(token!=null&&!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);
        if(body!=null){
            c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");
            try(OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}
        }
        int code=c.getResponseCode();InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
        String text=read(in);JSONObject j=text.isEmpty()?new JSONObject():new JSONObject(text);
        if(code<200||code>=300)throw new IOException(j.optString("error","HTTP "+code));
        return j;
    }
    private static String read(InputStream in)throws IOException{
        if(in==null)return "";ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;
        while((n=in.read(b))>0)out.write(b,0,n);return out.toString("UTF-8");
    }
}
