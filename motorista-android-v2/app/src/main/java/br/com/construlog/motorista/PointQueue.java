package br.com.construlog.motorista;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Fila de posições em arquivo. Toda posição passa por aqui: se não houver internet (ou o
 * servidor estiver fora), ela fica guardada e é enviada depois, em lote e na ordem.
 */
public final class PointQueue {
    private static final int MAX=3000;
    private static final ArrayList<String> items=new ArrayList<>();
    private static boolean loaded=false;

    private PointQueue(){}

    private static File file(Context c){return new File(c.getApplicationContext().getFilesDir(),"fila-posicoes.jsonl");}

    private static void load(Context c){
        if(loaded)return;
        loaded=true;
        File f=file(c);
        if(!f.exists())return;
        try(BufferedReader r=new BufferedReader(new InputStreamReader(new FileInputStream(f),StandardCharsets.UTF_8))){
            String line;
            while((line=r.readLine())!=null){
                line=line.trim();
                if(line.startsWith("{")&&line.endsWith("}"))items.add(line);
            }
        }catch(Exception ignored){}
        if(items.size()>MAX)items.subList(0,items.size()-MAX).clear();
    }

    private static void rewrite(Context c){
        try(Writer w=new OutputStreamWriter(new FileOutputStream(file(c),false),StandardCharsets.UTF_8)){
            for(String s:items){w.write(s);w.write('\n');}
        }catch(Exception ignored){}
    }

    public static synchronized void add(Context c,JSONObject point){
        load(c);
        String line=point.toString();
        items.add(line);
        if(items.size()>MAX){
            items.subList(0,items.size()-MAX).clear();
            rewrite(c);
            return;
        }
        try(Writer w=new OutputStreamWriter(new FileOutputStream(file(c),true),StandardCharsets.UTF_8)){
            w.write(line);w.write('\n');
        }catch(Exception ignored){}
    }

    public static synchronized List<String> peek(Context c,int n){
        load(c);
        return new ArrayList<>(items.subList(0,Math.min(n,items.size())));
    }

    public static synchronized void drop(Context c,int n){
        load(c);
        items.subList(0,Math.min(n,items.size())).clear();
        rewrite(c);
    }

    public static synchronized int size(Context c){
        load(c);
        return items.size();
    }
}
