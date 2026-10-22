// Curated library of verified MicroPython sensor and peripheral drivers
// for 1-click on-chip deployment to /lib/<name>.py

export const MICROPYTHON_DRIVERS = [
  {
    id: 'ssd1306',
    name: 'SSD1306 OLED Display',
    filename: 'ssd1306.py',
    category: 'Displays',
    description: 'Standard FrameBuffer driver for monochrome 128x64 & 128x32 OLED displays over I2C and SPI.',
    size: '3.8 KB',
    code: `# MicroPython SSD1306 OLED driver, I2C and SPI interfaces
import time
import framebuf

SET_CONTRAST = 0x81
SET_ENTIRE_ON = 0xA4
SET_NORM_INV = 0xA6
SET_DISP = 0xAE
SET_MEM_ADDR = 0x20
SET_COL_ADDR = 0x21
SET_PAGE_ADDR = 0x22
SET_DISP_START_LINE = 0x40
SET_SEG_REMAP = 0xA0
SET_MUX_RATIO = 0xA8
SET_COM_OUT_DIR = 0xC0
SET_DISP_OFFSET = 0xD3
SET_COM_PIN_CFG = 0xDA
SET_DISP_CLK_DIV = 0xD5
SET_PRECHARGE = 0xD9
SET_VCOM_DESEL = 0xDB
SET_CHARGE_PUMP = 0x8D

class SSD1306(framebuf.FrameBuffer):
    def __init__(self, width, height, external_vcc):
        self.width = width
        self.height = height
        self.external_vcc = external_vcc
        self.pages = self.height // 8
        self.buffer = bytearray(self.pages * self.width)
        super().__init__(self.buffer, self.width, self.height, framebuf.MONO_VLSB)
        self.init_display()

    def init_display(self):
        for cmd in (
            SET_DISP, SET_MEM_ADDR, 0x00, SET_DISP_START_LINE, SET_SEG_REMAP | 0x01,
            SET_MUX_RATIO, self.height - 1, SET_COM_OUT_DIR | 0x08, SET_DISP_OFFSET, 0x00,
            SET_COM_PIN_CFG, 0x02 if self.width > 2 * self.height else 0x12,
            SET_DISP_CLK_DIV, 0x80, SET_PRECHARGE, 0x22 if self.external_vcc else 0xF1,
            SET_VCOM_DESEL, 0x30, SET_CONTRAST, 0xFF, SET_ENTIRE_ON, SET_NORM_INV,
            SET_CHARGE_PUMP, 0x10 if self.external_vcc else 0x14, SET_DISP | 0x01
        ):
            self.write_cmd(cmd)
        self.fill(0)
        self.show()

    def poweroff(self): self.write_cmd(SET_DISP)
    def poweron(self): self.write_cmd(SET_DISP | 0x01)
    def contrast(self, contrast): self.write_cmd(SET_CONTRAST); self.write_cmd(contrast)
    def invert(self, invert): self.write_cmd(SET_NORM_INV | (invert & 1))

class SSD1306_I2C(SSD1306):
    def __init__(self, width, height, i2c, addr=0x3C, external_vcc=False):
        self.i2c = i2c
        self.addr = addr
        self.temp = bytearray(2)
        self.write_list = [b'\\x40', None]
        super().__init__(width, height, external_vcc)

    def write_cmd(self, cmd):
        self.temp[0] = 0x80
        self.temp[1] = cmd
        self.i2c.writeto(self.addr, self.temp)

    def show(self):
        x0 = 0
        x1 = self.width - 1
        if self.width == 64:
            x0 += 32
            x1 += 32
        self.write_cmd(SET_COL_ADDR)
        self.write_cmd(x0)
        self.write_cmd(x1)
        self.write_cmd(SET_PAGE_ADDR)
        self.write_cmd(0)
        self.write_cmd(self.pages - 1)
        self.write_list[1] = self.buffer
        self.i2c.writevto(self.addr, self.write_list)
`
  },
  {
    id: 'bme280',
    name: 'BME280 Environmental',
    filename: 'bme280.py',
    category: 'Sensors',
    description: 'Precision barometric pressure, ambient temperature, and relative humidity sensor over I2C.',
    size: '4.2 KB',
    code: `# MicroPython BME280 Driver
import time
import ustruct

BME280_I2CADDR = 0x76

class BME280:
    def __init__(self, i2c, addr=BME280_I2CADDR):
        self.i2c = i2c
        self.addr = addr
        self._read_calibration()
        # Set config: normal mode, 16x oversampling
        self.i2c.writeto_mem(self.addr, 0xF2, b'\\x01')
        self.i2c.writeto_mem(self.addr, 0xF4, b'\\x27')
        self.i2c.writeto_mem(self.addr, 0xF5, b'\\xA0')
        self.t_fine = 0

    def _read_calibration(self):
        cal = self.i2c.readfrom_mem(self.addr, 0x88, 24)
        self.dig_T = ustruct.unpack('<Hhh', cal[0:6])
        self.dig_P = ustruct.unpack('<Hhhhhhhhh', cal[6:24])
        self.dig_H1 = self.i2c.readfrom_mem(self.addr, 0xA1, 1)[0]
        h2 = self.i2c.readfrom_mem(self.addr, 0xE1, 7)
        self.dig_H2 = ustruct.unpack('<h', h2[0:2])[0]
        self.dig_H3 = h2[2]
        self.dig_H4 = (h2[3] << 4) | (h2[4] & 0x0F)
        self.dig_H5 = (h2[5] << 4) | (h2[4] >> 4)
        self.dig_H6 = ustruct.unpack('<b', h2[6:7])[0]

    def read_compensated_data(self):
        data = self.i2c.readfrom_mem(self.addr, 0xF7, 8)
        p_raw = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
        t_raw = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)
        h_raw = (data[6] << 8) | data[7]

        # Temp compensation
        var1 = (((t_raw >> 3) - (self.dig_T[0] << 1)) * self.dig_T[1]) >> 11
        var2 = (((((t_raw >> 4) - self.dig_T[0]) * ((t_raw >> 4) - self.dig_T[0])) >> 12) * self.dig_T[2]) >> 14
        self.t_fine = var1 + var2
        temp = ((self.t_fine * 5 + 128) >> 8) / 100.0

        # Pressure compensation
        var1 = self.t_fine - 128000
        var2 = var1 * var1 * self.dig_P[5]
        var2 = var2 + ((var1 * self.dig_P[4]) << 17)
        var2 = var2 + (self.dig_P[3] << 35)
        var1 = ((var1 * var1 * self.dig_P[2]) >> 8) + ((var1 * self.dig_P[1]) << 12)
        var1 = (((1 << 47) + var1) * self.dig_P[0]) >> 33
        if var1 == 0: pressure = 0
        else:
            p = 1048576 - p_raw
            p = (((p << 31) - var2) * 3125) // var1
            var1 = (self.dig_P[8] * (p >> 13) * (p >> 13)) >> 25
            var2 = (self.dig_P[7] * p) >> 19
            pressure = ((p + var1 + var2) >> 8) + (self.dig_P[6] << 4)
            pressure = (pressure / 256.0) / 100.0

        # Humidity compensation
        v_x1_u32r = self.t_fine - 76800
        v_x1_u32r = (((((h_raw << 14) - (self.dig_H4 << 20) - (self.dig_H5 * v_x1_u32r)) + 16384) >> 15) *
                     (((((((v_x1_u32r * self.dig_H6) >> 10) * (((v_x1_u32r * self.dig_H3) >> 11) + 32768)) >> 10) + 2097152) *
                       self.dig_H2 + 8192) >> 14))
        v_x1_u32r = v_x1_u32r - (((((v_x1_u32r >> 15) * (v_x1_u32r >> 15)) >> 7) * self.dig_H1) >> 4)
        v_x1_u32r = 0 if v_x1_u32r < 0 else v_x1_u32r
        v_x1_u32r = 419430400 if v_x1_u32r > 419430400 else v_x1_u32r
        humidity = (v_x1_u32r >> 12) / 1024.0

        return (temp, pressure, humidity)
`
  },
  {
    id: 'ahtx0',
    name: 'AHT10 / AHT20 Temp & Humidity',
    filename: 'ahtx0.py',
    category: 'Sensors',
    description: 'Driver for Aosong AHT10 and AHT20 high-accuracy relative humidity and temperature sensor.',
    size: '1.8 KB',
    code: `# MicroPython AHT10/AHT20 Driver
import time

AHTX0_I2CADDR = 0x38

class AHT10:
    def __init__(self, i2c, address=AHTX0_I2CADDR):
        self.i2c = i2c
        self.address = address
        time.sleep_ms(20)
        self.i2c.writeto(self.address, b'\\xE1\\x08\\x00')
        time.sleep_ms(20)

    def read(self):
        self.i2c.writeto(self.address, b'\\xAC\\x33\\x00')
        time.sleep_ms(80)
        data = self.i2c.readfrom(self.address, 6)
        humidity = ((data[1] << 12) | (data[2] << 4) | (data[3] >> 4)) * 100 / 1048576
        temperature = (((data[3] & 0x0F) << 16) | (data[4] << 8) | data[5]) * 200 / 1048576 - 50
        return (temperature, humidity)

    @property
    def temperature(self):
        return self.read()[0]

    @property
    def relative_humidity(self):
        return self.read()[1]
`
  },
  {
    id: 'mpu6050',
    name: 'MPU6050 6-DoF IMU',
    filename: 'mpu6050.py',
    category: 'Sensors',
    description: 'Triple-axis accelerometer and gyroscope motion tracking sensor.',
    size: '2.5 KB',
    code: `# MicroPython MPU6050 Driver
import time
import ustruct

class MPU6050:
    def __init__(self, i2c, addr=0x68):
        self.i2c = i2c
        self.addr = addr
        # Wake up device
        self.i2c.writeto_mem(self.addr, 0x6B, b'\\x00')
        time.sleep_ms(10)

    def get_raw_values(self):
        data = self.i2c.readfrom_mem(self.addr, 0x3B, 14)
        vals = ustruct.unpack('>hhhhhhh', data)
        return vals

    def get_values(self):
        raw = self.get_raw_values()
        # Scale: Accel +/- 2g (16384 LSB/g), Gyro +/- 250 deg/s (131 LSB/deg/s)
        return {
            'AcX': raw[0] / 16384.0,
            'AcY': raw[1] / 16384.0,
            'AcZ': raw[2] / 16384.0,
            'Tmp': raw[3] / 340.0 + 36.53,
            'GyX': raw[4] / 131.0,
            'GyY': raw[5] / 131.0,
            'GyZ': raw[6] / 131.0
        }
`
  },
  {
    id: 'umqtt_simple',
    name: 'uMQTT Simple Client',
    filename: 'umqtt/simple.py',
    category: 'Networking',
    description: 'Minimalist MQTT client for IoT telemetry, publishing to Mosquitto, Adafruit IO, or AWS IoT.',
    size: '3.4 KB',
    code: `# MicroPython umqtt.simple
import usocket as socket
import ustruct as struct

class MQTTException(Exception):
    pass

class MQTTClient:
    def __init__(self, client_id, server, port=1883, user=None, password=None, keepalive=0):
        self.client_id = client_id
        self.sock = None
        self.server = server
        self.port = port
        self.user = user
        self.pswd = password
        self.keepalive = keepalive
        self.pid = 0

    def connect(self, clean_session=True):
        self.sock = socket.socket()
        addr = socket.getaddrinfo(self.server, self.port)[0][-1]
        self.sock.connect(addr)
        premsg = bytearray(b"\\x10\\0\\0\\0\\0\\0")
        msg = bytearray(b"\\x04MQTT\\x04\\x02\\0\\0")
        sz = 10 + 2 + len(self.client_id)
        msg[7] = 2 if clean_session else 0
        if self.user:
            sz += 2 + len(self.user) + 2 + len(self.pswd)
            msg[7] |= 0xC0
        if self.keepalive:
            msg[8] = self.keepalive >> 8
            msg[9] = self.keepalive & 0x00FF
        premsg[1] = sz
        self.sock.write(premsg)
        self.sock.write(msg)
        self._send_str(self.client_id)
        if self.user:
            self._send_str(self.user)
            self._send_str(self.pswd)
        resp = self.sock.read(4)
        assert resp[0] == 0x20 and resp[1] == 0x02
        return resp[3]

    def _send_str(self, s):
        self.sock.write(struct.pack("!H", len(s)))
        self.sock.write(s)

    def publish(self, topic, msg, retain=False, qos=0):
        pkt = bytearray(b"\\x30\\0\\0\\0")
        pkt[0] |= (qos << 1) | (1 if retain else 0)
        sz = 2 + len(topic) + len(msg)
        pkt[1] = sz
        self.sock.write(pkt)
        self._send_str(topic)
        self.sock.write(msg)

    def disconnect(self):
        self.sock.write(b"\\xE0\\0")
        self.sock.close()
`
  },
  {
    id: 'vl53l0x',
    name: 'VL53L0X Time-of-Flight',
    filename: 'vl53l0x.py',
    category: 'Sensors',
    description: 'STMicroelectronics Time-of-Flight laser distance ranging sensor (up to 2 meters).',
    size: '3.1 KB',
    code: `# MicroPython VL53L0X Laser Ranging Driver
import time
import ustruct

class VL53L0X:
    def __init__(self, i2c, address=0x29):
        self.i2c = i2c
        self.address = address
        self.init_sensor()

    def init_sensor(self):
        # 2.8V IO mode config
        self.i2c.writeto_mem(self.address, 0x88, b'\\x00')
        self.i2c.writeto_mem(self.address, 0x80, b'\\x01')
        self.i2c.writeto_mem(self.address, 0xFF, b'\\x01')
        self.i2c.writeto_mem(self.address, 0x00, b'\\x00')
        self.i2c.writeto_mem(self.address, 0x91, b'\\x3c')
        self.i2c.writeto_mem(self.address, 0x00, b'\\x01')
        self.i2c.writeto_mem(self.address, 0xFF, b'\\x00')
        self.i2c.writeto_mem(self.address, 0x80, b'\\x00')

    def read_distance_mm(self):
        self.i2c.writeto_mem(self.address, 0x00, b'\\x01')
        time.sleep_ms(30)
        data = self.i2c.readfrom_mem(self.address, 0x14 + 10, 2)
        dist = ustruct.unpack('>H', data)[0]
        return dist
`
  }
];
