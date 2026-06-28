package com.gongjangjang.backend.ingest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.integration.channel.DirectChannel;
import org.springframework.integration.core.MessageProducer;
import org.springframework.integration.mqtt.core.DefaultMqttPahoClientFactory;
import org.springframework.integration.mqtt.core.MqttPahoClientFactory;
import org.springframework.integration.mqtt.inbound.MqttPahoMessageDrivenChannelAdapter;
import org.springframework.integration.mqtt.support.DefaultPahoMessageConverter;
import org.springframework.messaging.MessageChannel;

/**
 * MQTT inbound adapter (D-03/D-04/D-05): subscribes to {@code sensors/+} via
 * Spring Integration MQTT (Paho-backed) and feeds parsed readings to the
 * {@link SensorIngestPort}. This is the only place that knows about MQTT.
 *
 * <p>Mode branching (ingest.mode):
 * <ul>
 *   <li>batch (default) — cleanSession=false so the broker retains unacked QoS1
 *       messages across backend restarts (D-01 durability); manualAcks=true so
 *       the handler sends PUBACK only after DB commit (ack-after-commit).
 *   <li>naive — cleanSession=true + auto-ack (before baseline, D-08 kill-9 demo).
 * </ul>
 *
 * <p>clientId is fixed ("backend-ingest") — required for cleanSession=false
 * session identity; the broker uses clientId to re-attach the durable session.
 */
@Configuration
public class MqttIngestConfig {

    @Value("${mqtt.broker.url}")
    private String brokerUrl;

    @Value("${mqtt.client.id:backend-ingest}")
    private String clientId;

    @Value("${mqtt.topic:sensors/+}")
    private String topic;

    @Value("${ingest.mode:batch}")
    private String ingestMode;

    @Bean
    public MqttPahoClientFactory mqttClientFactory() {
        DefaultMqttPahoClientFactory factory = new DefaultMqttPahoClientFactory();
        org.eclipse.paho.client.mqttv3.MqttConnectOptions options =
                new org.eclipse.paho.client.mqttv3.MqttConnectOptions();
        options.setServerURIs(new String[] {brokerUrl});
        if ("batch".equals(ingestMode)) {
            // cleanSession=false: broker retains the session (unacked msgs) across restarts.
            // Combined with manualAcks=true this enables ack-after-commit (D-01).
            options.setCleanSession(false);
        } else {
            // naive mode: cleanSession=true (before baseline — broker drops unacked on disconnect).
            options.setCleanSession(true);
        }
        factory.setConnectionOptions(options);
        return factory;
    }

    @Bean
    public MessageChannel mqttInboundChannel() {
        return new DirectChannel();
    }

    @Bean
    public MessageProducer mqttInbound(MqttPahoClientFactory factory) {
        MqttPahoMessageDrivenChannelAdapter adapter =
                new MqttPahoMessageDrivenChannelAdapter(clientId, factory, topic);
        adapter.setQos(1);
        adapter.setConverter(new DefaultPahoMessageConverter());
        adapter.setOutputChannel(mqttInboundChannel());
        if ("batch".equals(ingestMode)) {
            // manualAcks=true: Spring Integration places the PUBACK callback in the
            // message header; MqttPayloadHandler captures it and calls it after DB commit.
            adapter.setManualAcks(true);
        }
        // naive mode: manualAcks remains false (default) — Paho auto-acks on delivery.
        return adapter;
    }
}
