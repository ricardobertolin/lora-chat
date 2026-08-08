// Heltec WiFi LoRa 32 (V3) - ESP32-S3 + SX1262 point-to-point ping/pong.
//
// Build once with -DROLE_PING and once without it:
//   PING node transmits every PING_INTERVAL_MS and listens the rest of the time.
//   PONG node listens and answers every PING it hears.
// Both nodes print every TX and RX to the serial monitor at 115200 baud.

#include <RadioLib.h>
#include <SPI.h>

// SX1262 wiring on the V3. Heltec's variant header calls the SX1262's DIO1 pin
// "DIO0" (GPIO14) for backwards compatibility with the SX127x V2 boards.
#define PIN_LORA_NSS 8
#define PIN_LORA_DIO1 14
#define PIN_LORA_RST 12
#define PIN_LORA_BUSY 13
#define PIN_LORA_SCK 9
#define PIN_LORA_MISO 11
#define PIN_LORA_MOSI 10

// Radio settings. Both nodes must agree on every one of these.
#define LORA_FREQ_MHZ 915.0
#define LORA_BW_KHZ 125.0
#define LORA_SF 9
#define LORA_CR 7
#define LORA_SYNC_WORD 0x12
#define LORA_POWER_DBM 14
#define LORA_PREAMBLE 8
#define LORA_TCXO_V 1.8  // the V3 clocks the SX1262 from a 1.8 V TCXO

#define PING_INTERVAL_MS 3000

SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST, PIN_LORA_BUSY);

#ifdef ROLE_PING
static const char *NODE_NAME = "PING";
static const bool IS_PINGER = true;
#else
static const char *NODE_NAME = "PONG";
static const bool IS_PINGER = false;
#endif

static volatile bool packetWaiting = false;
static uint32_t txCounter = 0;
static uint32_t lastPingAt = 0;

IRAM_ATTR void onDio1Rise() {
  packetWaiting = true;
}

static void sendPacket(const String &msg) {
  Serial.printf("[TX] \"%s\" ... ", msg.c_str());
  int state = radio.transmit(msg.c_str());
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("ok");
  } else {
    Serial.printf("failed, code %d\n", state);
  }
  // transmit() is blocking and fires DIO1 on TxDone, which sets the same flag
  // the RX path uses - drop it so we don't read a phantom packet.
  packetWaiting = false;
  radio.startReceive();
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // give the USB CDC bridge time to enumerate before first print
  Serial.printf("\n=== Heltec WiFi LoRa 32 V3 - node %s ===\n", NODE_NAME);

  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);

  int state = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC_WORD, LORA_POWER_DBM, LORA_PREAMBLE,
                          LORA_TCXO_V, false);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("radio.begin() failed, code %d - halting\n", state);
    while (true) {
      delay(1000);
    }
  }

  radio.setDio2AsRfSwitch(true);  // the V3 switches its RF frontend from DIO2
  radio.setPacketReceivedAction(onDio1Rise);

  state = radio.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("startReceive() failed, code %d - halting\n", state);
    while (true) {
      delay(1000);
    }
  }

  Serial.printf("listening on %.1f MHz, SF%d, BW %.0f kHz, %d dBm\n",
                LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ, LORA_POWER_DBM);
}

void loop() {
  if (packetWaiting) {
    packetWaiting = false;

    String msg;
    int state = radio.readData(msg);
    if (state == RADIOLIB_ERR_NONE) {
      Serial.printf("[RX] \"%s\"  RSSI %.1f dBm  SNR %.1f dB\n", msg.c_str(),
                    radio.getRSSI(), radio.getSNR());
      if (!IS_PINGER && msg.startsWith("PING")) {
        sendPacket(String("PONG #") + (++txCounter) + " re: " + msg);
        return;  // sendPacket already re-armed the receiver
      }
    } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
      Serial.println("[RX] packet dropped, CRC mismatch");
    } else {
      Serial.printf("[RX] readData() failed, code %d\n", state);
    }
    radio.startReceive();
  }

  if (IS_PINGER && millis() - lastPingAt >= PING_INTERVAL_MS) {
    lastPingAt = millis();
    sendPacket(String("PING #") + (++txCounter));
  }
}
