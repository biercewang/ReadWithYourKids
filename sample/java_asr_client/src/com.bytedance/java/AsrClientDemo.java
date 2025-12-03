package src.com.bytedance.java;

import com.fasterxml.jackson.core.JsonProcessingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.net.URISyntaxException;
import java.util.Arrays;

public class AsrClientDemo {
    private static final Logger logger = LoggerFactory.getLogger(AsrClientDemo.class);

    public static void main(String[] args) throws URISyntaxException, JsonProcessingException, FileNotFoundException {
        String appid = "";  // 项目的 appid
        String token = "";  // 项目的 token
        String cluster = "";  // 请求的集群
        String audio_path = "";  // 本地音频文件路径；
        String audio_format = "wav";  // wav 或者 mp3, 根据音频类型设置

        AsrClient asr_client = null;
        try {
            asr_client = AsrClient.build();
            asr_client.setAppid(appid);
            asr_client.setToken(token);
            asr_client.setCluster(cluster);
            asr_client.setFormat(audio_format);
            asr_client.setShow_utterances(true);
            asr_client.asr_sync_connect();

            File file = new File(audio_path);
            FileInputStream fp = new FileInputStream(file);
            byte[] b = new byte[16000];
            int len = 0;
            int count = 0;
            AsrResponse asr_response = new AsrResponse();
            while ((len = fp.read(b)) > 0) {
                count += 1;
                logger.info("send data pack length: {}, count {}, is_last {}", len, count, fp.available() == 0);
                asr_response = asr_client.asr_send(Arrays.copyOfRange(b, 0, len), fp.available() == 0);
            }

            // get asr text
//            AsrResponse response = asr_client.getAsrResponse();
            for (AsrResponse.Result result: asr_response.getResult()) {
                logger.info(result.getText());
            }
        } catch (Exception e) {
            System.err.println(e.getMessage());
        } finally {
            if (asr_client != null) {
                asr_client.asr_close();
            }
        }
    }
}
