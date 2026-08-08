// Heltec WiFi LoRa 32 (V3) - two-way LoRa chat over the serial monitor.
//
// Flash this SAME sketch to both boards - there is no sender/receiver role.
// Type a line in the Serial Monitor (115200 baud) and press Enter: it goes out
// over LoRa and appears on the other board's monitor. Anything the other board
// sends shows up here.
//
//   >> hello there            <- what this board sent
//   << 8424: hi back  (RSSI -25.0 dBm, SNR 10.5 dB)   <- what it heard
//
// The onboard OLED mirrors the last message and its signal strength, so you can
// unplug a board, walk it around and watch RSSI fall off without a laptop.

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <RadioLib.h>
#include <SPI.h>
#include <Wire.h>
#include <esp_mac.h>

// SX1262 wiring on the V3. Heltec's variant header calls the SX1262's DIO1 pin
// "DIO0" (GPIO14) for backwards compatibility with the SX127x V2 boards.
#define PIN_LORA_NSS 8
#define PIN_LORA_DIO1 14
#define PIN_LORA_RST 12
#define PIN_LORA_BUSY 13
#define PIN_LORA_SCK 9
#define PIN_LORA_MISO 11
#define PIN_LORA_MOSI 10

// Radio settings. Both boards must agree on every one of these.
#define LORA_FREQ_MHZ 915.0
#define LORA_BW_KHZ 125.0
#define LORA_SF 9
#define LORA_CR 7
#define LORA_SYNC_WORD 0x12
#define LORA_POWER_DBM 14
#define LORA_PREAMBLE 8
#define LORA_TCXO_V 1.8  // the V3 clocks the SX1262 from a 1.8 V TCXO

// Leave empty to name each board after the last 2 bytes of its MAC, which keeps
// the firmware identical on both. Set e.g. "ALICE" to pin a name to this board.
#define NODE_NAME ""

#define MAX_MSG_LEN 200
// If the Serial Monitor's line ending is set to "No Line Ending" we never see a
// newline, so a short lull in the input stream also counts as end-of-message.
#define INPUT_IDLE_MS 80

// Onboard SSD1306. Vext, RST_OLED, SDA_OLED and SCL_OLED come from the board
// variant header (GPIO 36 / 21 / 17 / 18).
#define OLED_W 128
#define OLED_H 64
#define OLED_ADDR 0x3C
#define OLED_COLS 21  // 128 px / 6 px per char at text size 1
#define MSG_LINES 3   // how many wrapped lines of the last message we show

SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST, PIN_LORA_BUSY);
Adafruit_SSD1306 oled(OLED_W, OLED_H, &Wire, -1);  // reset handled by hand below

static char nodeName[16];
static volatile bool packetWaiting = false;

static char inBuf[MAX_MSG_LEN + 1];
static size_t inLen = 0;
static uint32_t lastCharAt = 0;

static bool oledOk = false;
static String lastMsg = "waiting...";
static bool lastWasRx = false;
static float lastRssi = 0;
static float lastSnr = 0;
static uint32_t txCount = 0;
static uint32_t rxCount = 0;

IRAM_ATTR void onDio1Rise() {
  packetWaiting = true;
}

// The OLED sits behind the Vext switch, which is active LOW. Powering it up
// before Wire.begin() is what most "my V3 screen is dead" reports come down to.
static void oledPowerOn() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, LOW);
  delay(100);

  pinMode(RST_OLED, OUTPUT);
  digitalWrite(RST_OLED, LOW);
  delay(20);
  digitalWrite(RST_OLED, HIGH);
  delay(20);
}

static void drawScreen() {
  if (!oledOk) {
    return;
  }

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);

  oled.setCursor(0, 0);
  oled.print(nodeName);
  oled.setCursor(72, 0);
  oled.printf("%.1f", LORA_FREQ_MHZ);
  oled.drawFastHLine(0, 10, OLED_W, SSD1306_WHITE);

  // Body: the last message, truncated to what fits so it can never push the
  // stats off the bottom of the panel.
  oled.setCursor(0, 14);
  String body = String(lastWasRx ? "< " : "> ") + lastMsg;
  size_t room = OLED_COLS * MSG_LINES;
  if (body.length() > room) {
    body = body.substring(0, room - 1) + "~";
  }
  oled.print(body);

  if (lastWasRx) {
    oled.setCursor(0, 44);
    oled.printf("RSSI %.0f  SNR %.1f", lastRssi, lastSnr);
  }

  oled.setCursor(0, 56);
  oled.printf("TX %lu   RX %lu", txCount, rxCount);
  oled.display();
}

// Stop here, but say why on the screen as well - a board that failed while
// running on battery has no serial monitor attached to complain to.
static void halt(const char *what, int code) {
  Serial.printf("%s failed, code %d - halting\n", what, code);
  if (oledOk) {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setCursor(0, 0);
    oled.println("HALTED");
    oled.println();
    oled.println(what);
    oled.printf("code %d", code);
    oled.display();
  }
  while (true) {
    delay(1000);
  }
}

static void sendLine() {
  if (inLen == 0) {
    return;
  }
  inBuf[inLen] = '\0';
  inLen = 0;

  String payload = String(nodeName) + ": " + inBuf;
  int state = radio.transmit(payload.c_str());
  if (state == RADIOLIB_ERR_NONE) {
    Serial.printf(">> %s\n", inBuf);
    txCount++;
    lastMsg = inBuf;
    lastWasRx = false;
  } else {
    Serial.printf("!! send failed, code %d\n", state);
    lastMsg = "send failed";
    lastWasRx = false;
  }
  drawScreen();

  // transmit() raises DIO1 on TxDone, which sets the same flag the RX path
  // uses - drop it so we don't read a phantom packet.
  packetWaiting = false;
  radio.startReceive();
}

static void pollSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    lastCharAt = millis();

    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      sendLine();
      continue;
    }
    if (inLen < MAX_MSG_LEN) {
      inBuf[inLen++] = c;
    }
    if (inLen == MAX_MSG_LEN) {
      sendLine();  // full packet, ship it rather than truncating
    }
  }

  if (inLen > 0 && millis() - lastCharAt > INPUT_IDLE_MS) {
    sendLine();
  }
}

static void pollRadio() {
  if (!packetWaiting) {
    return;
  }
  packetWaiting = false;

  String msg;
  int state = radio.readData(msg);
  if (state == RADIOLIB_ERR_NONE) {
    lastRssi = radio.getRSSI();
    lastSnr = radio.getSNR();
    Serial.printf("<< %s  (RSSI %.1f dBm, SNR %.1f dB)\n", msg.c_str(),
                  lastRssi, lastSnr);
    rxCount++;
    lastMsg = msg;
    lastWasRx = true;
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    Serial.println("!! packet dropped, CRC mismatch");
    lastMsg = "CRC mismatch";
    lastWasRx = false;
  } else {
    Serial.printf("!! readData() failed, code %d\n", state);
    lastMsg = "RX error";
    lastWasRx = false;
  }
  drawScreen();
  radio.startReceive();
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // give the USB bridge time to enumerate before the first print

  strncpy(nodeName, NODE_NAME, sizeof(nodeName) - 1);
  if (nodeName[0] == '\0') {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(nodeName, sizeof(nodeName), "%02X%02X", mac[4], mac[5]);
  }

  Serial.printf("\n=== LoRa chat - this board is \"%s\" ===\n", nodeName);

  oledPowerOn();
  Wire.begin(SDA_OLED, SCL_OLED);
  Wire.setClock(400000);
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (oledOk) {
    oled.setRotation(0);
    drawScreen();
  } else {
    // Not fatal - the serial chat works fine without a screen.
    Serial.println("!! OLED not found at 0x3C, continuing without it");
  }

  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);

  int state = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC_WORD, LORA_POWER_DBM, LORA_PREAMBLE,
                          LORA_TCXO_V, false);
  if (state != RADIOLIB_ERR_NONE) {
    halt("radio.begin()", state);
  }

  radio.setDio2AsRfSwitch(true);  // the V3 switches its RF frontend from DIO2
  radio.setPacketReceivedAction(onDio1Rise);

  state = radio.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    halt("startReceive()", state);
  }

  Serial.printf("on %.1f MHz, SF%d. Type a message and press Enter.\n",
                LORA_FREQ_MHZ, LORA_SF);
}

void loop() {
  pollRadio();
  pollSerial();
}
