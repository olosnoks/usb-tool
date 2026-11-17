/**
 * I2C address reference: a curated, offline database of common I2C parts, plus the
 * helpers the I2C Address Reference tool needs (reserved-address meanings, 7-bit/8-bit
 * conversion, conflict checking and scan-output parsers). Pure logic, no hardware access.
 *
 * Sources
 * - Addresses: the Adafruit "I2C Addresses" list (https://learn.adafruit.com/i2c-addresses/the-list,
 *   data repo https://github.com/adafruit/I2C_Addresses), entries marked src: 'adafruit'.
 *   Parts that Adafruit does not list come from the vendor datasheet and are marked src: 'datasheet'.
 * - ID registers (idCheck): taken from vendor datasheets from memory of the register maps; they
 *   are NOT verified against hardware by this module. Confirm a value on a real part with the
 *   I2C & SPI Bus Explorer before relying on it. Parts without a simple, reliable ID register
 *   have idCheck: null.
 *
 * Entry shape
 *   id        unique slug
 *   part      part number / product name
 *   mfr       manufacturer (or family owner)
 *   category  one of I2C_CATEGORIES
 *   func      what the device does
 *   addr      array of 7-bit addresses the part can respond on (hex numbers)
 *   alt       free text about pin-selectable addresses, or null
 *   idCheck   { reg, expect, width?, note? } register to read and its expected value, or null
 *             width 1 (default) = one byte; width 2 = 16-bit big-endian value at reg
 *   low       true if an address below 0x08 is legitimate for this part
 *   note      optional caveat
 *   src       'adafruit' | 'datasheet'
 */

export const I2C_CATEGORIES = [
  'Environmental',
  'Pressure',
  'Motion / IMU',
  'Magnetometer / compass',
  'Light / color / proximity',
  'Distance / ToF',
  'Gas / air quality',
  'Power / current',
  'Battery / fuel gauge',
  'ADC / DAC',
  'Time / RTC',
  'Memory / EEPROM',
  'GPIO expander',
  'LED / PWM driver',
  'Display',
  'Touch / input',
  'Audio / radio',
  'Clock',
  'Mux / bus',
  'Thermal / IR',
  'Wireless / NFC / crypto',
  'USB-C / PD',
  'Motor / haptic / encoder',
  'Fan / thermal',
  'GNSS',
  'Other',
];

function range(from, to) {
  const out = [];
  for (let a = from; a <= to; a++) out.push(a);
  return out;
}

const AF = 'adafruit';
const DS = 'datasheet';

export const I2C_DEVICES = [
  // ---- Environmental -----------------------------------------------------------------
  { id: 'bme280', part: 'BME280', mfr: 'Bosch', category: 'Environmental', func: 'Temperature, pressure and humidity', addr: [0x76, 0x77], alt: 'SDO low = 0x76, SDO high = 0x77', idCheck: { reg: 0xD0, expect: 0x60 }, src: AF },
  { id: 'bme680', part: 'BME680', mfr: 'Bosch', category: 'Environmental', func: 'Temperature, pressure, humidity and gas (VOC)', addr: [0x76, 0x77], alt: 'SDO low = 0x76, SDO high = 0x77', idCheck: { reg: 0xD0, expect: 0x61 }, src: AF },
  { id: 'bmp280', part: 'BMP280', mfr: 'Bosch', category: 'Pressure', func: 'Temperature and barometric pressure', addr: [0x76, 0x77], alt: 'SDO low = 0x76, SDO high = 0x77', idCheck: { reg: 0xD0, expect: 0x58 }, src: AF },
  { id: 'bmp388', part: 'BMP388', mfr: 'Bosch', category: 'Pressure', func: 'Temperature and barometric pressure', addr: [0x76, 0x77], alt: 'SDO low = 0x76, SDO high = 0x77', idCheck: { reg: 0x00, expect: 0x50 }, src: AF },
  { id: 'bmp390', part: 'BMP390', mfr: 'Bosch', category: 'Pressure', func: 'Temperature and barometric pressure', addr: [0x76, 0x77], alt: 'SDO low = 0x76, SDO high = 0x77', idCheck: { reg: 0x00, expect: 0x60 }, src: AF },
  { id: 'bmp581', part: 'BMP581', mfr: 'Bosch', category: 'Pressure', func: 'Temperature and barometric pressure', addr: [0x46, 0x47], alt: 'SDO selects 0x46 / 0x47', idCheck: { reg: 0x01, expect: 0x50 }, src: DS },
  { id: 'bmp180', part: 'BMP180', mfr: 'Bosch', category: 'Pressure', func: 'Temperature and barometric pressure', addr: [0x77], alt: null, idCheck: { reg: 0xD0, expect: 0x55 }, src: AF },
  { id: 'bmp085', part: 'BMP085', mfr: 'Bosch', category: 'Pressure', func: 'Temperature and barometric pressure (BMP180 predecessor)', addr: [0x77], alt: null, idCheck: { reg: 0xD0, expect: 0x55 }, src: AF },
  { id: 'dps310', part: 'DPS310', mfr: 'Infineon', category: 'Pressure', func: 'Barometric pressure and temperature', addr: [0x76, 0x77], alt: 'SDO selects 0x76 / 0x77', idCheck: { reg: 0x0D, expect: 0x10 }, src: AF },
  { id: 'ms5611', part: 'MS5611-01BA', mfr: 'TE Connectivity', category: 'Pressure', func: 'Barometric pressure and temperature', addr: [0x76, 0x77], alt: 'CSB selects 0x76 / 0x77', idCheck: null, src: AF },
  { id: 'ms5837', part: 'MS5837-30BA', mfr: 'TE Connectivity', category: 'Pressure', func: 'Depth / pressure sensor (underwater)', addr: [0x76], alt: null, idCheck: null, src: DS },
  { id: 'ms8607', part: 'MS8607', mfr: 'TE Connectivity', category: 'Environmental', func: 'Humidity (0x40) plus pressure and temperature (0x76)', addr: [0x40, 0x76], alt: 'two devices behind one package', idCheck: null, src: AF },
  { id: 'mpl3115a2', part: 'MPL3115A2', mfr: 'NXP', category: 'Pressure', func: 'Altitude / barometric pressure and temperature', addr: [0x60], alt: null, idCheck: { reg: 0x0C, expect: 0xC4 }, src: AF },
  { id: 'mpl115a2', part: 'MPL115A2', mfr: 'NXP', category: 'Pressure', func: 'Barometric pressure', addr: [0x60], alt: null, idCheck: null, src: AF },
  { id: 'lps22hb', part: 'LPS22HB (LPS22)', mfr: 'STMicroelectronics', category: 'Pressure', func: 'Barometric pressure and temperature', addr: [0x5C, 0x5D], alt: 'SA0 selects 0x5C / 0x5D', idCheck: { reg: 0x0F, expect: 0xB1 }, src: AF },
  { id: 'lps25hb', part: 'LPS25HB (LPS25)', mfr: 'STMicroelectronics', category: 'Pressure', func: 'Barometric pressure and temperature', addr: [0x5C, 0x5D], alt: 'SA0 selects 0x5C / 0x5D', idCheck: { reg: 0x0F, expect: 0xBD }, src: AF },
  { id: 'lps33hw', part: 'LPS33HW', mfr: 'STMicroelectronics', category: 'Pressure', func: 'Ported barometric pressure', addr: [0x5C, 0x5D], alt: 'SA0 selects 0x5C / 0x5D', idCheck: null, src: AF },
  { id: 'lps35hw', part: 'LPS35HW', mfr: 'STMicroelectronics', category: 'Pressure', func: 'Barometric pressure', addr: [0x5C, 0x5D], alt: 'SA0 selects 0x5C / 0x5D', idCheck: null, src: AF },
  { id: 'sht31', part: 'SHT31', mfr: 'Sensirion', category: 'Environmental', func: 'Temperature and humidity', addr: [0x44, 0x45], alt: 'ADDR pin selects 0x44 / 0x45', idCheck: null, src: AF },
  { id: 'sht40', part: 'SHT40', mfr: 'Sensirion', category: 'Environmental', func: 'Temperature and humidity', addr: [0x44], alt: null, idCheck: null, src: AF },
  { id: 'sht45', part: 'SHT45', mfr: 'Sensirion', category: 'Environmental', func: 'Temperature and humidity', addr: [0x44], alt: null, idCheck: null, src: AF },
  { id: 'shtc3', part: 'SHTC3', mfr: 'Sensirion', category: 'Environmental', func: 'Temperature and humidity', addr: [0x70], alt: null, idCheck: null, src: AF },
  { id: 'hdc1080', part: 'HDC1080', mfr: 'Texas Instruments', category: 'Environmental', func: 'Temperature and humidity', addr: [0x40, 0x41, 0x42, 0x43], alt: 'A0 / A1 pins select 0x40 to 0x43', idCheck: { reg: 0xFF, expect: 0x1050, width: 2, note: 'DEVICE_ID' }, src: AF },
  { id: 'hdc2010', part: 'HDC2010', mfr: 'Texas Instruments', category: 'Environmental', func: 'Temperature and humidity', addr: [0x40, 0x41], alt: 'ADDR pin selects 0x40 / 0x41', idCheck: { reg: 0xFE, expect: 0x5449, width: 2, note: 'MANUFACTURER_ID (TI)' }, src: DS },
  { id: 'htu21d', part: 'HTU21D-F', mfr: 'TE Connectivity (Measurement Specialties)', category: 'Environmental', func: 'Temperature and humidity', addr: [0x40], alt: null, idCheck: null, src: AF },
  { id: 'si7021', part: 'Si7021', mfr: 'Silicon Labs', category: 'Environmental', func: 'Temperature and humidity', addr: [0x40], alt: null, idCheck: null, note: 'Electronic serial is read with a command, not a register.', src: AF },
  { id: 'htu31d', part: 'HTU31D', mfr: 'TE Connectivity', category: 'Environmental', func: 'Temperature and humidity', addr: [0x40, 0x41], alt: 'ADDR pin selects 0x40 / 0x41', idCheck: null, src: AF },
  { id: 'aht20', part: 'AHT20', mfr: 'Aosong', category: 'Environmental', func: 'Temperature and humidity', addr: [0x38], alt: null, idCheck: null, src: AF },
  { id: 'dht20', part: 'DHT20', mfr: 'Aosong', category: 'Environmental', func: 'Temperature and humidity', addr: [0x38], alt: null, idCheck: null, src: AF },
  { id: 'am2315', part: 'AM2315', mfr: 'Aosong', category: 'Environmental', func: 'Temperature and humidity', addr: [0x5C], alt: null, idCheck: null, src: AF },
  { id: 'am2320', part: 'AM2320', mfr: 'Aosong', category: 'Environmental', func: 'Temperature and humidity', addr: [0x5C], alt: null, idCheck: null, src: AF },
  { id: 'ens160', part: 'ENS160', mfr: 'ScioSense', category: 'Gas / air quality', func: 'Indoor air quality (TVOC, eCO2)', addr: [0x52, 0x53], alt: 'ADDR pin selects 0x52 / 0x53', idCheck: null, src: DS },
  { id: 'mlx90614', part: 'MLX90614', mfr: 'Melexis', category: 'Thermal / IR', func: 'Non-contact IR thermometer', addr: [0x5A], alt: null, idCheck: null, src: DS },
  { id: 'mlx90640', part: 'MLX90640', mfr: 'Melexis', category: 'Thermal / IR', func: '32x24 IR thermal camera array', addr: [0x33], alt: null, idCheck: null, src: AF },
  { id: 'amg8833', part: 'AMG8833', mfr: 'Panasonic', category: 'Thermal / IR', func: '8x8 IR thermal camera', addr: [0x68, 0x69], alt: 'AD_SELECT pin selects 0x68 / 0x69', idCheck: null, src: AF },
  { id: 'mlx90393', part: 'MLX90393', mfr: 'Melexis', category: 'Magnetometer / compass', func: '3-axis magnetometer', addr: [0x0C, 0x0D, 0x0E, 0x0F], alt: 'address set by OTP / pins; 0x0C to 0x0F', idCheck: null, low: true, src: AF },
  { id: 'hts221', part: 'HTS221', mfr: 'STMicroelectronics', category: 'Environmental', func: 'Humidity and temperature', addr: [0x5F], alt: null, idCheck: { reg: 0x0F, expect: 0xBC }, src: AF },
  { id: 'sps30', part: 'SPS30', mfr: 'Sensirion', category: 'Gas / air quality', func: 'Particulate matter (PM) sensor', addr: [0x69], alt: null, idCheck: null, src: DS },
  { id: 'tmp117', part: 'TMP117', mfr: 'Texas Instruments', category: 'Environmental', func: 'High-accuracy temperature', addr: [0x48, 0x49, 0x4A, 0x4B], alt: 'ADD0 pin selects 0x48 to 0x4B', idCheck: { reg: 0x0F, expect: 0x0117, width: 2, note: 'DEVICE_ID' }, src: AF },
  { id: 'tmp102', part: 'TMP102', mfr: 'Texas Instruments', category: 'Environmental', func: 'Temperature', addr: [0x48, 0x49, 0x4A, 0x4B], alt: 'ADD0 pin selects 0x48 to 0x4B', idCheck: null, src: AF },
  { id: 'adt7410', part: 'ADT7410', mfr: 'Analog Devices', category: 'Environmental', func: 'Temperature', addr: [0x48, 0x49, 0x4A, 0x4B], alt: 'A0 / A1 pins select address', idCheck: null, src: AF },
  { id: 'tmp006', part: 'TMP006', mfr: 'Texas Instruments', category: 'Thermal / IR', func: 'Contactless IR die temperature', addr: range(0x40, 0x47), alt: 'A0 / A1 pins select address', idCheck: null, src: AF },
  { id: 'tmp007', part: 'TMP007', mfr: 'Texas Instruments', category: 'Thermal / IR', func: 'Contactless IR die temperature', addr: range(0x40, 0x47), alt: 'A0 / A1 pins select address', idCheck: null, src: AF },
  { id: 'mcp9808', part: 'MCP9808', mfr: 'Microchip', category: 'Environmental', func: 'Temperature (precision)', addr: range(0x18, 0x1F), alt: 'A0 to A2 pins select 0x18 to 0x1F', idCheck: { reg: 0x06, expect: 0x0054, width: 2, note: 'MANUFACTURER_ID' }, src: AF },
  { id: 'mcp9600', part: 'MCP9600', mfr: 'Microchip', category: 'Thermal / IR', func: 'Thermocouple amplifier (K, J, T, ...)', addr: range(0x60, 0x67), alt: 'A0 to A2 pins select address', idCheck: null, src: AF },
  { id: 'max30205', part: 'MAX30205', mfr: 'Analog Devices (Maxim)', category: 'Environmental', func: 'Body / surface temperature', addr: range(0x48, 0x4F), alt: 'A0 to A2 pins select address', idCheck: null, src: DS },
  { id: 'lm75', part: 'LM75 / LM75B', mfr: 'Texas Instruments', category: 'Environmental', func: 'Temperature sensor and thermal alarm', addr: range(0x48, 0x4F), alt: 'A0 to A2 pins select address', idCheck: null, src: DS },
  { id: 'pct2075', part: 'PCT2075', mfr: 'NXP', category: 'Environmental', func: 'Temperature sensor and thermal alarm', addr: [...range(0x28, 0x2E), ...range(0x48, 0x4F), ...range(0x70, 0x77)], alt: 'address set by pins; Adafruit lists these ranges', idCheck: null, src: AF },
  { id: 'emc2101', part: 'EMC2101', mfr: 'Microchip (SMSC)', category: 'Fan / thermal', func: 'Fan controller with internal and external temperature', addr: [0x4C], alt: null, idCheck: null, src: AF },
  { id: 'hih6130', part: 'HIH6130', mfr: 'Honeywell', category: 'Environmental', func: 'Humidity and temperature', addr: [0x27], alt: null, idCheck: null, src: DS },
  { id: 'as5600', part: 'AS5600', mfr: 'ams OSRAM', category: 'Motor / haptic / encoder', func: '12-bit magnetic rotary encoder', addr: [0x36], alt: null, idCheck: null, src: DS },

  // ---- Motion / IMU -------------------------------------------------------------------
  { id: 'mpu6050', part: 'MPU-6050', mfr: 'InvenSense (TDK)', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x68, 0x69], alt: 'AD0 low = 0x68, AD0 high = 0x69', idCheck: { reg: 0x75, expect: 0x68, note: 'WHO_AM_I' }, src: AF },
  { id: 'mpu6500', part: 'MPU-6500', mfr: 'InvenSense (TDK)', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x68, 0x69], alt: 'AD0 selects 0x68 / 0x69', idCheck: { reg: 0x75, expect: 0x70, note: 'WHO_AM_I' }, src: DS },
  { id: 'mpu9250', part: 'MPU-9250', mfr: 'InvenSense (TDK)', category: 'Motion / IMU', func: '9-axis IMU (AK8963 magnetometer is behind it)', addr: [0x68, 0x69], alt: 'AD0 selects 0x68 / 0x69', idCheck: { reg: 0x75, expect: 0x71, note: 'WHO_AM_I' }, src: AF },
  { id: 'icm20948', part: 'ICM-20948', mfr: 'InvenSense (TDK)', category: 'Motion / IMU', func: '9-axis IMU (AK09916 magnetometer is behind it)', addr: [0x68, 0x69], alt: 'AD0 selects 0x68 / 0x69', idCheck: { reg: 0x00, expect: 0xEA, note: 'WHO_AM_I in bank 0 (bank select 0x7F = 0)' }, src: DS },
  { id: 'icm20649', part: 'ICM-20649', mfr: 'InvenSense (TDK)', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x68, 0x69], alt: 'AD0 selects 0x68 / 0x69', idCheck: { reg: 0x75, expect: 0xE1, note: 'WHO_AM_I' }, src: AF },
  { id: 'bmi160', part: 'BMI160', mfr: 'Bosch', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x68, 0x69], alt: 'SDO selects 0x68 / 0x69', idCheck: { reg: 0x00, expect: 0xD1, note: 'CHIP_ID' }, src: DS },
  { id: 'bmi270', part: 'BMI270', mfr: 'Bosch', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x68, 0x69], alt: 'SDO selects 0x68 / 0x69', idCheck: { reg: 0x00, expect: 0x24, note: 'CHIP_ID' }, src: DS },
  { id: 'bma400', part: 'BMA400', mfr: 'Bosch', category: 'Motion / IMU', func: 'Low-power 3-axis accelerometer', addr: [0x14, 0x15], alt: 'SDO selects 0x14 / 0x15', idCheck: { reg: 0x00, expect: 0x90, note: 'CHIP_ID' }, src: DS },
  { id: 'lsm6ds33', part: 'LSM6DS33', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x6A, 0x6B], alt: 'SA0 selects 0x6A / 0x6B', idCheck: { reg: 0x0F, expect: 0x69, note: 'WHO_AM_I' }, src: AF },
  { id: 'lsm6dsox', part: 'LSM6DSOX', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x6A, 0x6B], alt: 'SA0 selects 0x6A / 0x6B', idCheck: { reg: 0x0F, expect: 0x6C, note: 'WHO_AM_I' }, src: AF },
  { id: 'ism330dhcx', part: 'ISM330DHCX', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x6A, 0x6B], alt: 'SA0 selects 0x6A / 0x6B', idCheck: { reg: 0x0F, expect: 0x6B, note: 'WHO_AM_I' }, src: DS },
  { id: 'icm330dhc', part: 'ICM-330DHC', mfr: 'TDK', category: 'Motion / IMU', func: '6-axis accelerometer and gyroscope', addr: [0x6A, 0x6B], alt: 'SDO selects 0x6A / 0x6B', idCheck: null, src: AF },
  { id: 'l3gd20h', part: 'L3GD20H', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '3-axis gyroscope', addr: [0x6A, 0x6B], alt: 'SA0 selects 0x6A / 0x6B', idCheck: { reg: 0x0F, expect: 0xD7, note: 'WHO_AM_I' }, src: AF },
  { id: 'lsm9ds0', part: 'LSM9DS0', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '9-axis IMU (accel/mag at 0x1D/0x1E, gyro at 0x6A/0x6B)', addr: [0x1D, 0x1E, 0x6A, 0x6B], alt: 'separate accel/mag and gyro addresses', idCheck: null, src: AF },
  { id: 'lsm9ds1', part: 'LSM9DS1', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '9-axis IMU (accel/gyro at 0x6A/0x6B, mag at 0x1C/0x1E)', addr: [0x1C, 0x1E, 0x6A, 0x6B], alt: 'separate accel/gyro and mag addresses', idCheck: null, src: DS },
  { id: 'lis3dh', part: 'LIS3DH', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x18, 0x19], alt: 'SA0 selects 0x18 / 0x19', idCheck: { reg: 0x0F, expect: 0x33, note: 'WHO_AM_I' }, src: AF },
  { id: 'lis2dh12', part: 'LIS2DH12', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x18, 0x19], alt: 'SA0 selects 0x18 / 0x19', idCheck: { reg: 0x0F, expect: 0x33, note: 'WHO_AM_I' }, src: DS },
  { id: 'lis331dlh', part: 'LIS331DLH (LIS331)', mfr: 'STMicroelectronics', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x18, 0x19], alt: 'SA0 selects 0x18 / 0x19', idCheck: { reg: 0x0F, expect: 0x32, note: 'WHO_AM_I' }, src: AF },
  { id: 'adxl343', part: 'ADXL343', mfr: 'Analog Devices', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x1D, 0x53], alt: 'ALT ADDRESS pin selects 0x1D / 0x53', idCheck: { reg: 0x00, expect: 0xE5, note: 'DEVID' }, src: AF },
  { id: 'adxl345', part: 'ADXL345', mfr: 'Analog Devices', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x1D, 0x53], alt: 'ALT ADDRESS pin selects 0x1D / 0x53', idCheck: { reg: 0x00, expect: 0xE5, note: 'DEVID' }, src: AF },
  { id: 'mma8451', part: 'MMA8451Q (MMA845x)', mfr: 'NXP', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x1C, 0x1D], alt: 'SA0 selects 0x1C / 0x1D', idCheck: { reg: 0x0D, expect: 0x1A, note: 'WHO_AM_I' }, src: AF },
  { id: 'mma7455', part: 'MMA7455L', mfr: 'NXP / Freescale', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x1C, 0x1D], alt: 'address pin selects 0x1C / 0x1D', idCheck: null, src: AF },
  { id: 'msa301', part: 'MSA301', mfr: 'MEMSIC', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x26], alt: null, idCheck: null, src: AF },
  { id: 'fxos8700', part: 'FXOS8700', mfr: 'NXP', category: 'Motion / IMU', func: '6-axis accelerometer and magnetometer', addr: [0x1C, 0x1D, 0x1E, 0x1F], alt: 'SA0 / SA1 pins select 0x1C to 0x1F', idCheck: { reg: 0x0D, expect: 0xC7, note: 'WHO_AM_I' }, src: AF },
  { id: 'fxas21002', part: 'FXAS21002', mfr: 'NXP', category: 'Motion / IMU', func: '3-axis gyroscope', addr: [0x20, 0x21], alt: 'SA0 selects 0x20 / 0x21', idCheck: { reg: 0x0C, expect: 0xD7, note: 'WHO_AM_I' }, src: AF },
  { id: 'bno055', part: 'BNO055', mfr: 'Bosch', category: 'Motion / IMU', func: '9-axis absolute orientation (fusion MCU)', addr: [0x28, 0x29], alt: 'COM3 pin selects 0x28 / 0x29', idCheck: { reg: 0x00, expect: 0xA0, note: 'CHIP_ID (page 0)' }, src: AF },
  { id: 'bno085', part: 'BNO085', mfr: 'CEVA (Hillcrest)', category: 'Motion / IMU', func: '9-axis IMU with sensor fusion (SHTP protocol)', addr: [0x4A, 0x4B], alt: 'ADDR pin selects 0x4A / 0x4B', idCheck: null, src: AF },
  { id: 'bma180', part: 'BMA180', mfr: 'Bosch', category: 'Motion / IMU', func: '3-axis accelerometer', addr: [0x77], alt: 'Adafruit list gives 0x77 only; verify against the datasheet', idCheck: null, src: AF },
  { id: 'ak8963', part: 'AK8963', mfr: 'Asahi Kasei (AKM)', category: 'Magnetometer / compass', func: '3-axis magnetometer inside MPU-9250 (usually bus-internal)', addr: [0x0C], alt: null, idCheck: { reg: 0x00, expect: 0x48, note: 'WIA' }, src: DS },
  { id: 'ak09916', part: 'AK09916', mfr: 'Asahi Kasei (AKM)', category: 'Magnetometer / compass', func: '3-axis magnetometer inside ICM-20948 (usually bus-internal)', addr: [0x0C], alt: null, idCheck: { reg: 0x01, expect: 0x09, note: 'WIA2' }, src: DS },

  // ---- Magnetometers ----------------------------------------------------------------
  { id: 'hmc5883l', part: 'HMC5883L', mfr: 'Honeywell', category: 'Magnetometer / compass', func: '3-axis magnetometer (compass)', addr: [0x1E], alt: null, idCheck: { reg: 0x0A, expect: 0x48, note: 'ID register A reads ASCII H' }, src: AF },
  { id: 'qmc5883l', part: 'QMC5883L', mfr: 'QST', category: 'Magnetometer / compass', func: '3-axis magnetometer (compass)', addr: [0x0D], alt: null, idCheck: { reg: 0x0D, expect: 0xFF, note: 'CHIP_ID' }, src: AF },
  { id: 'lis3mdl', part: 'LIS3MDL', mfr: 'STMicroelectronics', category: 'Magnetometer / compass', func: '3-axis magnetometer', addr: [0x1C, 0x1E], alt: 'SA1 selects 0x1C / 0x1E', idCheck: { reg: 0x0F, expect: 0x3D, note: 'WHO_AM_I' }, src: AF },
  { id: 'lis2mdl', part: 'LIS2MDL', mfr: 'STMicroelectronics', category: 'Magnetometer / compass', func: '3-axis magnetometer', addr: [0x1E], alt: null, idCheck: { reg: 0x4F, expect: 0x40, note: 'WHO_AM_I' }, src: AF },
  { id: 'mag3110', part: 'MAG3110', mfr: 'NXP', category: 'Magnetometer / compass', func: '3-axis magnetometer', addr: [0x0E], alt: null, idCheck: { reg: 0x07, expect: 0xC4, note: 'WHO_AM_I' }, low: true, src: AF },
  { id: 'bmm150', part: 'BMM150', mfr: 'Bosch', category: 'Magnetometer / compass', func: '3-axis geomagnetic sensor', addr: [0x10, 0x11, 0x12, 0x13], alt: 'address set by pins', idCheck: { reg: 0x40, expect: 0x32, note: 'CHIP_ID' }, src: DS },
  { id: 'tlv493d', part: 'TLV493D', mfr: 'Infineon', category: 'Magnetometer / compass', func: '3D Hall magnetic sensor', addr: [0x5E], alt: null, idCheck: null, src: AF },
  { id: 'lsm303', part: 'LSM303DLHC / LSM303AGR', mfr: 'STMicroelectronics', category: 'Magnetometer / compass', func: 'Accelerometer (0x19) plus magnetometer (0x1E)', addr: [0x19, 0x1E], alt: 'two devices behind one package', idCheck: null, src: AF },

  // ---- Light / color / proximity -----------------------------------------------------
  { id: 'bh1750', part: 'BH1750', mfr: 'ROHM', category: 'Light / color / proximity', func: 'Ambient light (lux)', addr: [0x23, 0x5C], alt: 'ADDR pin low = 0x23, high = 0x5C', idCheck: null, src: AF },
  { id: 'tsl2561', part: 'TSL2561', mfr: 'ams (TAOS)', category: 'Light / color / proximity', func: 'Ambient light', addr: [0x29, 0x39, 0x49], alt: 'ADDR pin selects 0x29 / 0x39 / 0x49', idCheck: null, src: AF },
  { id: 'tsl2591', part: 'TSL2591', mfr: 'ams (TAOS)', category: 'Light / color / proximity', func: 'High dynamic range ambient light', addr: [0x28, 0x29], alt: 'Adafruit lists 0x28 and 0x29', idCheck: null, src: AF },
  { id: 'tcs34725', part: 'TCS34725', mfr: 'ams (TAOS)', category: 'Light / color / proximity', func: 'RGB and clear color sensor', addr: [0x29], alt: null, idCheck: { reg: 0x92, expect: 0x44, note: 'ID register 0x12 with command bit 0x80 set, so the byte read is 0x92' }, src: AF },
  { id: 'apds9960', part: 'APDS-9960', mfr: 'Broadcom (Avago)', category: 'Light / color / proximity', func: 'Gesture, proximity, color and ambient light', addr: [0x39], alt: null, idCheck: { reg: 0x92, expect: 0xAB, note: 'ID register' }, src: AF },
  { id: 'veml7700', part: 'VEML7700', mfr: 'Vishay', category: 'Light / color / proximity', func: 'Ambient light', addr: [0x10], alt: null, idCheck: null, src: AF },
  { id: 'veml6075', part: 'VEML6075', mfr: 'Vishay', category: 'Light / color / proximity', func: 'UVA / UVB light', addr: [0x10], alt: null, idCheck: null, src: AF },
  { id: 'veml6070', part: 'VEML6070', mfr: 'Vishay', category: 'Light / color / proximity', func: 'UV index', addr: [0x38, 0x39], alt: 'ARA pin selects 0x38 / 0x39', idCheck: null, src: AF },
  { id: 'vcnl4040', part: 'VCNL4040', mfr: 'Vishay', category: 'Light / color / proximity', func: 'Proximity and ambient light', addr: [0x60], alt: null, idCheck: { reg: 0x0C, expect: 0x0186, width: 2, note: 'ID register' }, src: AF },
  { id: 'vcnl4010', part: 'VCNL4010', mfr: 'Vishay', category: 'Light / color / proximity', func: 'Proximity and ambient light', addr: [0x13], alt: null, idCheck: null, src: AF },
  { id: 'vcnl4200', part: 'VCNL4200', mfr: 'Vishay', category: 'Distance / ToF', func: 'Long-range proximity and ambient light', addr: [0x51], alt: null, idCheck: null, src: DS },
  { id: 'si1145', part: 'Si1145', mfr: 'Silicon Labs', category: 'Light / color / proximity', func: 'UV index, IR and visible light', addr: [0x60], alt: null, idCheck: { reg: 0x00, expect: 0x45, note: 'PART_ID' }, src: AF },
  { id: 'isl29125', part: 'ISL29125', mfr: 'Renesas (Intersil)', category: 'Light / color / proximity', func: 'RGB color sensor', addr: [0x44], alt: null, idCheck: { reg: 0x00, expect: 0x7D, note: 'DEVICE_ID' }, src: AF },
  { id: 'as7341', part: 'AS7341', mfr: 'ams OSRAM', category: 'Light / color / proximity', func: '11-channel spectral (color) sensor', addr: [0x39], alt: null, idCheck: null, src: AF },
  { id: 'as7262', part: 'AS7262 (AS726x triad)', mfr: 'ams OSRAM', category: 'Light / color / proximity', func: 'Six-channel visible spectral sensor', addr: [0x49], alt: null, idCheck: null, src: AF },
  { id: 'ltr390', part: 'LTR390', mfr: 'Lite-On', category: 'Light / color / proximity', func: 'UV and ambient light', addr: [0x53], alt: null, idCheck: { reg: 0x06, expect: 0xB2, note: 'PART_ID' }, src: AF },
  { id: 'opt3001', part: 'OPT3001', mfr: 'Texas Instruments', category: 'Light / color / proximity', func: 'Ambient light (lux)', addr: [0x44, 0x45, 0x46, 0x47], alt: 'ADDR pin selects 0x44 to 0x47', idCheck: { reg: 0x7F, expect: 0x3001, width: 2, note: 'DEVICE_ID' }, src: DS },
  { id: 'max30102', part: 'MAX30102', mfr: 'Analog Devices (Maxim)', category: 'Light / color / proximity', func: 'Pulse oximeter and heart-rate sensor', addr: [0x57], alt: null, idCheck: { reg: 0xFF, expect: 0x15, note: 'PART_ID' }, src: AF },
  { id: 'max30105', part: 'MAX30105', mfr: 'Analog Devices (Maxim)', category: 'Light / color / proximity', func: 'Particle / pulse / color sensor', addr: [0x57], alt: null, idCheck: { reg: 0xFF, expect: 0x15, note: 'PART_ID' }, src: AF },
  { id: 'nau7802', part: 'NAU7802', mfr: 'Nuvoton', category: 'ADC / DAC', func: '24-bit load cell (strain gauge) ADC', addr: [0x2A], alt: null, idCheck: null, src: DS },

  // ---- Distance / ToF -----------------------------------------------------------------
  { id: 'vl53l0x', part: 'VL53L0X', mfr: 'STMicroelectronics', category: 'Distance / ToF', func: 'Time-of-flight ranging', addr: [0x29], alt: 'software can move the address', idCheck: { reg: 0xC0, expect: 0xEE, note: 'IDENTIFICATION_MODEL_ID' }, src: AF },
  { id: 'vl53l1x', part: 'VL53L1X', mfr: 'STMicroelectronics', category: 'Distance / ToF', func: 'Long-range time-of-flight ranging', addr: [0x29], alt: 'software can move the address', idCheck: null, note: 'Model ID is a 16-bit register (0x010F, expect 0xEACC), not supported by the single-register check.', src: AF },
  { id: 'vl6180x', part: 'VL6180X', mfr: 'STMicroelectronics', category: 'Distance / ToF', func: 'Short-range proximity and ambient light', addr: [0x29], alt: null, idCheck: null, note: 'ID is a 16-bit register (0x0000, expect 0xB4), not supported by the single-register check.', src: AF },
  { id: 'pa1010d', part: 'PA1010D', mfr: 'Quectel (Adafruit Mini GPS)', category: 'GNSS', func: 'GPS / GNSS receiver (NMEA over I2C)', addr: [0x10], alt: null, idCheck: null, src: AF },

  // ---- Gas / air quality ----------------------------------------------------------
  { id: 'ccs811', part: 'CCS811', mfr: 'ams OSRAM', category: 'Gas / air quality', func: 'eCO2 and TVOC', addr: [0x5A, 0x5B], alt: 'ADDR pin selects 0x5A / 0x5B', idCheck: { reg: 0x20, expect: 0x81, note: 'HW_ID' }, src: AF },
  { id: 'sgp30', part: 'SGP30', mfr: 'Sensirion', category: 'Gas / air quality', func: 'TVOC and eCO2', addr: [0x58], alt: null, idCheck: null, src: AF },
  { id: 'sgp40', part: 'SGP40', mfr: 'Sensirion', category: 'Gas / air quality', func: 'VOC index', addr: [0x59], alt: null, idCheck: null, src: AF },
  { id: 'sgp41', part: 'SGP41', mfr: 'Sensirion', category: 'Gas / air quality', func: 'VOC and NOx index', addr: [0x59], alt: null, idCheck: null, src: DS },
  { id: 'scd30', part: 'SCD30', mfr: 'Sensirion', category: 'Gas / air quality', func: 'CO2, temperature and humidity (NDIR)', addr: [0x61], alt: null, idCheck: null, src: AF },
  { id: 'scd4x', part: 'SCD40 / SCD41', mfr: 'Sensirion', category: 'Gas / air quality', func: 'CO2, temperature and humidity (NDIR)', addr: [0x62], alt: null, idCheck: null, src: DS },
  { id: 'ags02ma', part: 'AGS02MA', mfr: 'AMS (AGS)', category: 'Gas / air quality', func: 'TVOC gas sensor', addr: [0x1A], alt: null, idCheck: null, src: AF },

  // ---- Power / current ------------------------------------------------------------
  { id: 'ina219', part: 'INA219', mfr: 'Texas Instruments', category: 'Power / current', func: 'High-side current, voltage and power', addr: range(0x40, 0x4F), alt: 'A0 / A1 pins select address', idCheck: null, src: AF },
  { id: 'ina226', part: 'INA226', mfr: 'Texas Instruments', category: 'Power / current', func: 'High-side current, voltage and power', addr: range(0x40, 0x4F), alt: 'A0 / A1 pins select address', idCheck: { reg: 0xFE, expect: 0x5449, width: 2, note: 'MANUFACTURER_ID (TI)' }, src: DS },
  { id: 'ina260', part: 'INA260', mfr: 'Texas Instruments', category: 'Power / current', func: 'Precision current, voltage and power', addr: range(0x40, 0x4F), alt: 'A0 / A1 pins select address', idCheck: { reg: 0xFE, expect: 0x5449, width: 2, note: 'MANUFACTURER_ID (TI)' }, src: AF },
  { id: 'ina3221', part: 'INA3221', mfr: 'Texas Instruments', category: 'Power / current', func: 'Three-channel current and voltage monitor', addr: range(0x40, 0x43), alt: 'A0 pin selects address', idCheck: { reg: 0xFE, expect: 0x5449, width: 2, note: 'MANUFACTURER_ID (TI)' }, src: DS },
  { id: 'ds3502', part: 'DS3502', mfr: 'Analog Devices (Maxim)', category: 'Power / current', func: 'Digital 10k potentiometer (wiper over I2C)', addr: range(0x28, 0x2B), alt: 'A0 / A1 pins select address', idCheck: null, src: AF },
  { id: 'tusb320', part: 'TUSB320', mfr: 'Texas Instruments', category: 'USB-C / PD', func: 'USB Type-C configuration controller', addr: [0x47], alt: null, idCheck: null, src: DS },
  { id: 'stusb4500', part: 'STUSB4500', mfr: 'STMicroelectronics', category: 'USB-C / PD', func: 'USB Power Delivery sink controller', addr: [0x28], alt: null, idCheck: null, src: DS },
  { id: 'husb238', part: 'HUSB238', mfr: 'Hynetek', category: 'USB-C / PD', func: 'USB PD sink controller', addr: [0x08], alt: null, idCheck: null, src: DS },
  { id: 'fusb302b', part: 'FUSB302B', mfr: 'onsemi', category: 'USB-C / PD', func: 'USB Type-C and PD controller', addr: range(0x22, 0x25), alt: 'address set by pins', idCheck: null, src: AF },

  // ---- Battery / fuel gauge -------------------------------------------------------
  { id: 'max17048', part: 'MAX17048', mfr: 'Analog Devices (Maxim)', category: 'Battery / fuel gauge', func: 'LiPo / Li-ion state of charge', addr: [0x36], alt: null, idCheck: null, src: AF },
  { id: 'max17043', part: 'MAX17043', mfr: 'Analog Devices (Maxim)', category: 'Battery / fuel gauge', func: 'LiPo / Li-ion state of charge', addr: [0x36], alt: null, idCheck: null, src: DS },
  { id: 'lc709203f', part: 'LC709203F', mfr: 'onsemi', category: 'Battery / fuel gauge', func: 'Battery fuel gauge', addr: [0x0B], alt: null, idCheck: null, low: true, src: AF },
  { id: 'bq27441', part: 'BQ27441-G1', mfr: 'Texas Instruments', category: 'Battery / fuel gauge', func: 'Battery fuel gauge', addr: [0x55], alt: null, idCheck: null, src: DS },

  // ---- ADC / DAC ----------------------------------------------------------------------
  { id: 'ads1115', part: 'ADS1115', mfr: 'Texas Instruments', category: 'ADC / DAC', func: '4-channel 16-bit ADC with PGA', addr: [0x48, 0x49, 0x4A, 0x4B], alt: 'ADDR pin: GND 0x48, VDD 0x49, SDA 0x4A, SCL 0x4B', idCheck: null, src: AF },
  { id: 'ads1015', part: 'ADS1015', mfr: 'Texas Instruments', category: 'ADC / DAC', func: '4-channel 12-bit ADC with PGA', addr: [0x48, 0x49, 0x4A, 0x4B], alt: 'ADDR pin: GND 0x48, VDD 0x49, SDA 0x4A, SCL 0x4B', idCheck: null, src: DS },
  { id: 'pcf8591', part: 'PCF8591', mfr: 'NXP', category: 'ADC / DAC', func: '4-channel 8-bit ADC and 8-bit DAC', addr: range(0x48, 0x4F), alt: 'A0 to A2 pins select address', idCheck: null, src: AF },
  { id: 'mcp3421', part: 'MCP3421', mfr: 'Microchip', category: 'ADC / DAC', func: '18-bit delta-sigma ADC', addr: range(0x68, 0x6F), alt: 'A0 to A2 pins select address', idCheck: null, src: DS },
  { id: 'mcp4725', part: 'MCP4725', mfr: 'Microchip', category: 'ADC / DAC', func: '12-bit DAC with EEPROM', addr: range(0x60, 0x67), alt: 'A0 to A2 variants (Adafruit: A0 0x60/0x61, A1 0x62/0x63, A2 0x64/0x65, A3 0x66/0x67)', idCheck: null, src: AF },
  { id: 'mcp4728', part: 'MCP4728', mfr: 'Microchip', category: 'ADC / DAC', func: 'Quad 12-bit DAC', addr: [0x60], alt: null, idCheck: null, src: AF },
  { id: 'tsc2007', part: 'TSC2007', mfr: 'Texas Instruments', category: 'ADC / DAC', func: 'Touch screen controller with ADC', addr: [0x48], alt: null, idCheck: null, src: DS },

  // ---- Time / RTC ---------------------------------------------------------------------
  { id: 'ds3231', part: 'DS3231', mfr: 'Analog Devices (Maxim)', category: 'Time / RTC', func: 'Real-time clock with temperature-compensated crystal', addr: [0x68], alt: null, idCheck: null, src: AF },
  { id: 'ds1307', part: 'DS1307', mfr: 'Analog Devices (Maxim)', category: 'Time / RTC', func: 'Real-time clock with 56-byte RAM', addr: [0x68], alt: null, idCheck: null, src: AF },
  { id: 'pcf8523', part: 'PCF8523', mfr: 'NXP', category: 'Time / RTC', func: 'Real-time clock / calendar', addr: [0x68], alt: null, idCheck: null, src: AF },
  { id: 'pcf8563', part: 'PCF8563', mfr: 'NXP', category: 'Time / RTC', func: 'Real-time clock / calendar', addr: [0x51], alt: null, idCheck: null, src: DS },
  { id: 'rv3028', part: 'RV-3028-C7', mfr: 'Micro Crystal', category: 'Time / RTC', func: 'Real-time clock with temperature compensation', addr: [0x52], alt: null, idCheck: null, src: DS },

  // ---- Memory / EEPROM ----------------------------------------------------------------
  { id: 'at24cxx', part: 'AT24Cxx family (24LCxx compatible)', mfr: 'Microchip (Atmel)', category: 'Memory / EEPROM', func: 'I2C EEPROM (1 kbit to 2 Mbit depending on part)', addr: range(0x50, 0x57), alt: 'A0 to A2 pins select address (blocks above 16 kbit use the pins differently)', idCheck: null, src: AF },
  { id: 'mb85rc', part: 'MB85RC FRAM', mfr: 'Fujitsu / Cypress (Infineon)', category: 'Memory / EEPROM', func: 'I2C FRAM (non-volatile RAM)', addr: range(0x50, 0x57), alt: 'A0 to A2 pins select address', idCheck: null, src: AF },
  { id: 'edid', part: 'EDID EEPROM / DDC', mfr: 'VESA (display data channel)', category: 'Display', func: 'Monitor identification (EDID at 0x50, DDC/CI at 0x37, E-DDC segment pointer at 0x30)', addr: [0x30, 0x37, 0x50], alt: 'fixed addresses on DDC display channel', idCheck: null, src: AF },

  // ---- GPIO expanders ----------------------------------------------------------------
  { id: 'pcf8574', part: 'PCF8574', mfr: 'NXP', category: 'GPIO expander', func: '8-bit quasi-bidirectional I/O expander', addr: range(0x20, 0x27), alt: 'A0 to A2 pins select 0x20 to 0x27', idCheck: null, src: AF },
  { id: 'pcf8574a', part: 'PCF8574A', mfr: 'NXP', category: 'GPIO expander', func: '8-bit quasi-bidirectional I/O expander', addr: range(0x38, 0x3F), alt: 'A0 to A2 pins select 0x38 to 0x3F', idCheck: null, src: AF },
  { id: 'mcp23008', part: 'MCP23008', mfr: 'Microchip', category: 'GPIO expander', func: '8-bit I/O expander', addr: range(0x20, 0x27), alt: 'A0 to A2 pins select 0x20 to 0x27', idCheck: null, src: AF },
  { id: 'mcp23017', part: 'MCP23017', mfr: 'Microchip', category: 'GPIO expander', func: '16-bit I/O expander', addr: range(0x20, 0x27), alt: 'A0 to A2 pins select 0x20 to 0x27', idCheck: null, src: AF },
  { id: 'tca9555', part: 'TCA9555', mfr: 'Texas Instruments', category: 'GPIO expander', func: '16-bit I/O expander with interrupt', addr: range(0x20, 0x27), alt: 'A0 to A2 pins select 0x20 to 0x27', idCheck: null, src: DS },
  { id: 'tca9534', part: 'TCA9534', mfr: 'Texas Instruments', category: 'GPIO expander', func: '8-bit I/O expander', addr: range(0x38, 0x3F), alt: 'A0 to A2 pins select 0x38 to 0x3F', idCheck: null, src: DS },
  { id: 'pca9536', part: 'PCA9536', mfr: 'NXP', category: 'GPIO expander', func: '4-bit I/O expander', addr: [0x41], alt: null, idCheck: null, src: DS },
  { id: 'aw9523', part: 'AW9523', mfr: 'Awinic', category: 'GPIO expander', func: '16-channel GPIO expander and LED driver', addr: range(0x58, 0x5B), alt: 'AD pin selects 0x58 to 0x5B', idCheck: { reg: 0x10, expect: 0x23, note: 'chip ID' }, src: AF },
  { id: 'tca8418', part: 'TCA8418', mfr: 'Texas Instruments', category: 'Touch / input', func: 'Keypad matrix scanner with GPIO', addr: [0x34], alt: null, idCheck: null, src: DS },

  // ---- LED / PWM driver --------------------------------------------------------------
  { id: 'pca9685', part: 'PCA9685', mfr: 'NXP', category: 'LED / PWM driver', func: '16-channel 12-bit PWM (servo / LED driver)', addr: range(0x40, 0x77), alt: 'set by A0 to A5 pins (7-bit range 0x40 to 0x77 here, since 0x78 to 0x7F are reserved); default 0x40 (Adafruit PWM HATs), 0x60 on Adafruit motor shields/HATs', idCheck: null, src: AF },
  { id: 'is31fl3731', part: 'IS31FL3731', mfr: 'ISSI', category: 'LED / PWM driver', func: '144-LED Charlieplex matrix driver', addr: [0x74, 0x75, 0x76, 0x77], alt: 'SD pin selects 0x74 to 0x77 (Adafruit list prints 0x66, probably a typo for 0x76)', idCheck: null, src: AF },
  { id: 'ht16k33', part: 'HT16K33', mfr: 'Holtek', category: 'LED / PWM driver', func: 'LED matrix / 7-segment driver with key scan', addr: range(0x70, 0x77), alt: 'A0 to A2 pins select 0x70 to 0x77', idCheck: null, src: AF },
  { id: 'ncp5623', part: 'NCP5623', mfr: 'onsemi', category: 'LED / PWM driver', func: '3-channel LED driver', addr: [0x38], alt: null, idCheck: null, src: AF },
  { id: 'si5351', part: 'Si5351A', mfr: 'Silicon Labs', category: 'Clock', func: 'Programmable clock generator', addr: [0x60, 0x61], alt: 'ADDR pin selects 0x60 / 0x61', idCheck: null, src: AF },
  { id: 'drv2605', part: 'DRV2605L', mfr: 'Texas Instruments', category: 'Motor / haptic / encoder', func: 'Haptic motor driver with effect library', addr: [0x5A], alt: null, idCheck: null, src: AF },
  { id: 'seesaw-rotary', part: 'Adafruit Seesaw rotary encoder with NeoPixel', mfr: 'Adafruit (seesaw firmware)', category: 'Motor / haptic / encoder', func: 'Rotary encoder with button and NeoPixel', addr: range(0x36, 0x3D), alt: 'set by solder jumper / firmware', idCheck: null, src: AF },

  // ---- Display --------------------------------------------------------------------------
  { id: 'ssd1306', part: 'SSD1306 OLED', mfr: 'Solomon Systech', category: 'Display', func: 'Monochrome OLED controller (128x64, 128x32)', addr: [0x3C, 0x3D], alt: 'SA0 / D/C pin selects 0x3C / 0x3D (solder jumper on many boards)', idCheck: null, src: AF },
  { id: 'sh1106', part: 'SH1106 OLED', mfr: 'Sino Wealth', category: 'Display', func: 'Monochrome OLED controller (132x64)', addr: [0x3C, 0x3D], alt: 'selected by pin or solder jumper', idCheck: null, src: AF },
  { id: 'ssd1305', part: 'SSD1305 OLED', mfr: 'Solomon Systech', category: 'Display', func: 'Monochrome OLED controller', addr: [0x3C, 0x3D], alt: 'selected by pin', idCheck: null, src: AF },
  { id: 'ssd1309', part: 'SSD1309 OLED', mfr: 'Solomon Systech', category: 'Display', func: 'Monochrome OLED controller', addr: [0x3C, 0x3D], alt: 'selected by pin', idCheck: null, src: AF },
  { id: 'ssd1315', part: 'SSD1315 OLED', mfr: 'Solomon Systech', category: 'Display', func: 'Monochrome OLED controller', addr: [0x3C, 0x3D], alt: 'selected by pin', idCheck: null, src: AF },
  { id: 'ssd1327', part: 'SSD1327 OLED', mfr: 'Solomon Systech', category: 'Display', func: '16-level grayscale OLED controller', addr: [0x3C, 0x3D], alt: 'selected by pin', idCheck: null, src: AF },
  { id: 'ch1115', part: 'CH1115 OLED', mfr: 'WCH', category: 'Display', func: 'Monochrome OLED controller', addr: [0x3C, 0x3D], alt: 'selected by pin', idCheck: null, src: AF },
  { id: 'st75256', part: 'ST75256 LCD', mfr: 'Sitronix', category: 'Display', func: '4-level grayscale LCD controller', addr: range(0x3C, 0x3F), alt: 'selected by pins', idCheck: null, src: AF },
  { id: 'lcd-backpack', part: 'HD44780 LCD I2C backpack (PCF8574)', mfr: 'Generic (PCF8574 backpack)', category: 'Display', func: '16x2 / 20x4 character LCD via PCF8574', addr: [0x27, 0x3F], alt: 'PCF8574 variant 0x27 or PCF8574A variant 0x3F', idCheck: null, src: DS },

  // ---- Touch / input ------------------------------------------------------------------
  { id: 'mpr121', part: 'MPR121', mfr: 'NXP (Freescale)', category: 'Touch / input', func: '12-channel capacitive touch sensor', addr: range(0x5A, 0x5D), alt: 'ADDR pin selects 0x5A to 0x5D', idCheck: null, src: AF },
  { id: 'cap1188', part: 'CAP1188', mfr: 'Microchip (SMSC)', category: 'Touch / input', func: '8-channel capacitive touch sensor', addr: range(0x28, 0x2D), alt: 'ADDR pins select 0x28 to 0x2D', idCheck: { reg: 0xFD, expect: 0x50, note: 'PRODUCT_ID' }, src: AF },
  { id: 'ft6x06', part: 'FT6206 / FT6236 touch controller', mfr: 'FocalTech', category: 'Touch / input', func: 'Capacitive touch controller (display panels)', addr: [0x38], alt: null, idCheck: null, src: AF },
  { id: 'neokey-1x4', part: 'NeoKey 1x4 (seesaw)', mfr: 'Adafruit (seesaw firmware)', category: 'Touch / input', func: 'Four key switches with NeoPixels', addr: range(0x30, 0x3F), alt: 'set by firmware / jumpers', idCheck: null, src: AF },
  { id: 'seesaw-gamepad', part: 'Mini I2C Gamepad (seesaw)', mfr: 'Adafruit (seesaw firmware)', category: 'Touch / input', func: 'Button and joystick gamepad', addr: range(0x50, 0x53), alt: 'set by firmware / jumpers', idCheck: null, src: AF },
  { id: 'nunchuk', part: 'Nintendo Wii Nunchuk', mfr: 'Nintendo', category: 'Touch / input', func: 'Joystick and accelerometer controller', addr: [0x52], alt: null, idCheck: null, src: AF },

  // ---- Audio / radio -------------------------------------------------------------------
  { id: 'tpa2016', part: 'TPA2016D2', mfr: 'Texas Instruments', category: 'Audio / radio', func: 'Class-D audio amplifier with AGC', addr: [0x58], alt: null, idCheck: null, src: AF },
  { id: 'si4713', part: 'Si4713', mfr: 'Silicon Labs', category: 'Audio / radio', func: 'FM transmitter with RDS', addr: [0x11, 0x63], alt: 'SEN pin selects 0x11 / 0x63', idCheck: null, src: AF },
  { id: 'tea5767', part: 'TEA5767', mfr: 'NXP', category: 'Audio / radio', func: 'FM radio receiver', addr: [0x60], alt: null, idCheck: null, src: AF },
  { id: 'sgtl5000', part: 'SGTL5000', mfr: 'NXP', category: 'Audio / radio', func: 'Low-power stereo audio codec', addr: [0x0A, 0x2A], alt: 'CTRL_ADR0 pin selects 0x0A / 0x2A', idCheck: null, src: DS },

  // ---- Mux / bus ----------------------------------------------------------------------
  { id: 'tca9548a', part: 'TCA9548A', mfr: 'Texas Instruments', category: 'Mux / bus', func: '1-to-8 I2C multiplexer (channel select)', addr: range(0x70, 0x77), alt: 'A0 to A2 pins select 0x70 to 0x77', idCheck: null, src: AF },
  { id: 'pca9548a', part: 'PCA9548A', mfr: 'NXP', category: 'Mux / bus', func: '1-to-8 I2C multiplexer (channel select)', addr: range(0x70, 0x77), alt: 'A0 to A2 pins select 0x70 to 0x77', idCheck: null, src: DS },
  { id: 'tca9546a', part: 'TCA9546A', mfr: 'Texas Instruments', category: 'Mux / bus', func: '1-to-4 I2C multiplexer (channel select)', addr: range(0x70, 0x77), alt: 'A0 to A2 pins select 0x70 to 0x77', idCheck: null, src: DS },

  // ---- Wireless / NFC / crypto ----------------------------------------------------
  { id: 'pn532', part: 'PN532 NFC/RFID', mfr: 'NXP', category: 'Wireless / NFC / crypto', func: 'NFC / RFID reader and writer', addr: [0x24], alt: 'fixed unless reconfigured', idCheck: null, src: AF },
  { id: 'atecc608', part: 'ATECC608', mfr: 'Microchip', category: 'Wireless / NFC / crypto', func: 'Secure element / crypto co-processor', addr: [0x60], alt: 'set in configuration zone', idCheck: null, src: AF },
  { id: 'atsha204a', part: 'ATSHA204A', mfr: 'Microchip', category: 'Wireless / NFC / crypto', func: 'SHA-256 / HMAC authentication device', addr: [0x64], alt: 'set in configuration zone', idCheck: null, src: DS },
];

/** Reserved / special addresses from the I2C specification, with their meaning. */
export const RESERVED_ADDRESS_MEANINGS = {
  0x00: 'General call address (reserved)',
  0x01: 'Reserved for CBUS compatibility',
  0x02: 'Reserved for I2C-compatible bus variants',
  0x03: 'Reserved for future use',
  0x04: 'Reserved for high-speed (HS-mode) controller codes',
  0x05: 'Reserved for high-speed (HS-mode) controller codes',
  0x06: 'Reserved for high-speed (HS-mode) controller codes',
  0x07: 'Reserved for high-speed (HS-mode) controller codes',
  0x78: 'Reserved for 10-bit addressing prefix',
  0x79: 'Reserved for 10-bit addressing prefix',
  0x7A: 'Reserved for 10-bit addressing prefix',
  0x7B: 'Reserved for 10-bit addressing prefix',
  0x7C: 'Reserved for future purposes',
  0x7D: 'Reserved for future purposes',
  0x7E: 'Reserved for future purposes',
  0x7F: 'Reserved for future purposes',
};

/** Meaning of a reserved address, or null for an address a normal device may use. */
export function reservedMeaning(address) {
  return RESERVED_ADDRESS_MEANINGS[address] ?? null;
}

export function formatAddress(address) {
  return `0x${address.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** All devices that list `address` (7-bit) among their addresses. */
export function devicesAtAddress(address) {
  return I2C_DEVICES.filter((d) => d.addr.includes(address));
}

/** Case-insensitive search over part, manufacturer, category, function, id and address text. */
export function searchDevices(query, devices = I2C_DEVICES) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return devices;
  // "0x3c" or "3c" style queries also match addresses
  const hexQuery = q.replace(/^0x/, '');
  const addrMatch = /^[0-9a-f]{2}$/.test(hexQuery) ? parseInt(hexQuery, 16) : null;
  return devices.filter((d) => {
    if (addrMatch !== null && d.addr.includes(addrMatch)) return true;
    const hay = [d.part, d.mfr, d.category, d.func, d.id, d.note || ''].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** 7-bit address to the byte used on the wire for a write (R/W bit = 0). */
export function toWriteByte(address7) {
  return (address7 << 1) & 0xFF;
}

/** 7-bit address to the byte used on the wire for a read (R/W bit = 1). */
export function toReadByte(address7) {
  return ((address7 << 1) | 1) & 0xFF;
}

/** Convert an 8-bit bus byte (as shown in datasheets) back to the 7-bit address. */
export function fromEightBitByte(byte8) {
  return { address7: (byte8 >> 1) & 0x7F, rw: (byte8 & 1) ? 'read' : 'write' };
}

/**
 * Parse an address typed by the user. "0x3C", "$3C" or "3c" are hex; a bare
 * decimal-looking value is still hex (I2C addresses are conventionally hex). Returns null if invalid.
 */
export function parseAddressInput(text) {
  const s = String(text || '').trim().replace(/^\$/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,2}$/i.test(s)) return null;
  const v = parseInt(s, 16);
  return v >= 0 && v <= 0x7F ? v : null;
}

/**
 * Conflict checker. `deviceIds` are ids from I2C_DEVICES. Returns the address clashes among
 * the chosen parts, and for each part whether it has alternates to move to.
 */
export function checkConflicts(deviceIds) {
  const chosen = (deviceIds || [])
    .map((id) => I2C_DEVICES.find((d) => d.id === id))
    .filter(Boolean);
  const byAddress = new Map();
  for (const dev of chosen) {
    for (const a of dev.addr) {
      if (!byAddress.has(a)) byAddress.set(a, []);
      byAddress.get(a).push(dev);
    }
  }
  const conflicts = [];
  for (const [address, devs] of [...byAddress.entries()].sort((x, y) => x[0] - y[0])) {
    if (devs.length < 2) continue;
    conflicts.push({
      address,
      hex: formatAddress(address),
      devices: devs.map((d) => {
        // addresses used by the other chosen parts (not counting this part's own list)
        const usedByOthers = new Set(chosen.filter((x) => x !== d).flatMap((x) => x.addr));
        return {
          id: d.id,
          part: d.part,
          adjustable: d.addr.length > 1,
          // alternates this part could move to that no other chosen part uses
          freeAlternatives: d.addr.filter((a) => a !== address && !usedByOthers.has(a)).map(formatAddress),
        };
      }),
    });
  }
  return {
    chosen: chosen.map((d) => ({ id: d.id, part: d.part, addresses: d.addr.map(formatAddress), adjustable: d.addr.length > 1 })),
    conflicts,
    clean: conflicts.length === 0,
  };
}

// ---- scan output parsers -------------------------------------------------------------

const I2CDETECT_ROW = /^\s*([0-9a-fA-F]{2}):/;

/**
 * Parse `i2cdetect` output (Linux i2c-tools, also `i2cdetect -r`). Each row starts with the
 * row base ("00:", "10:" ...) and has 16 cells: an address (e.g. "3c"), "--" (no response),
 * "UU" (in use by a kernel driver) or blank (not probed). Cells are read by position so blank
 * cells are kept; lines that are not rows are ignored.
 */
export function parseI2cDetect(text) {
  const found = new Map();
  let rows = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const m = I2CDETECT_ROW.exec(rawLine);
    if (!m) continue;
    rows++;
    const base = parseInt(m[1], 16);
    if (base % 16 !== 0) continue;
    const colon = rawLine.indexOf(':');
    const tokens = rawLine.slice(colon + 1).trim().split(/\s+/);
    for (let col = 0; col < 16; col++) {
      let cell;
      if (tokens.length === 16) {
        cell = tokens[col];
      } else {
        // positional: each cell is " XX" (3 chars) after the colon
        cell = rawLine.substr(colon + 1 + 3 * col, 3).trim();
      }
      const addr = base + col;
      if (addr > 0x7F) continue;
      if (cell === 'UU') found.set(addr, { address: addr, inUse: true });
      else if (/^[0-9a-fA-F]{2}$/.test(cell)) found.set(addr, { address: addr, inUse: false });
    }
  }
  return {
    format: 'i2cdetect',
    rows,
    found: [...found.values()].sort((a, b) => a.address - b.address),
    invalid: [],
  };
}

/**
 * Parse Arduino I2C scanner sketch output, e.g.
 *   "I2C device found at address 0x3C  !"
 *   "Unknown error at address 0x42"
 */
export function parseArduinoScan(text) {
  const found = new Map();
  const errors = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const ok = /I2C device found at address\s+0x([0-9a-fA-F]{1,2})\b/i.exec(line);
    if (ok) {
      const a = parseInt(ok[1], 16);
      found.set(a, { address: a, inUse: false });
      continue;
    }
    const err = /Unknown error at address\s+0x([0-9a-fA-F]{1,2})\b/i.exec(line);
    if (err) errors.push(parseInt(err[1], 16));
  }
  return {
    format: 'arduino',
    found: [...found.values()].sort((a, b) => a.address - b.address),
    errors,
    invalid: [],
  };
}

/**
 * Parse a plain list of addresses separated by spaces, commas or semicolons. Each token is
 * hex, with or without "0x" ("0x3C", "3C"). Tokens that are not valid 7-bit addresses are returned
 * in `invalid` instead of being dropped silently.
 */
export function parseHexList(text) {
  const found = new Map();
  const invalid = [];
  for (const tok of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(?:0x)?([0-9a-fA-F]{1,2})$/i.exec(tok);
    const a = m ? parseInt(m[1], 16) : NaN;
    if (!m || a > 0x7F) invalid.push(tok);
    else found.set(a, { address: a, inUse: false });
  }
  return {
    format: 'hex-list',
    found: [...found.values()].sort((a, b) => a.address - b.address),
    invalid,
  };
}

/**
 * Detect the scan format and parse it. Arduino output is recognised by its "device found"
 * line, i2cdetect by its "NN:" row grid, anything else is read as a hex list.
 */
export function parseScanText(text) {
  const s = String(text || '');
  if (!s.trim()) return { format: 'empty', found: [], invalid: [] };
  if (/I2C device found at address/i.test(s) || /Unknown error at address/i.test(s)) return parseArduinoScan(s);
  if (s.split(/\r?\n/).some((l) => I2CDETECT_ROW.test(l) && /(?:--|UU|[0-9a-fA-F]{2})\s/.test(l))) return parseI2cDetect(s);
  return parseHexList(s);
}

/**
 * For each found address: reserved meaning, candidate parts, and which ID register (if any)
 * distinguishes the candidates. Parts without an idCheck are listed in `unverifiable`.
 */
export function analyzeScan(found) {
  return (found || []).map(({ address, inUse }) => {
    const candidates = devicesAtAddress(address);
    const idChecks = candidates
      .filter((d) => d.idCheck)
      .map((d) => ({
        id: d.id,
        part: d.part,
        reg: d.idCheck.reg,
        regHex: formatAddress(d.idCheck.reg),
        expect: d.idCheck.expect,
        width: d.idCheck.width || 1,
        note: d.idCheck.note || '',
      }));
    const unverifiable = candidates.filter((d) => !d.idCheck).map((d) => d.part);
    let suggestion;
    if (reservedMeaning(address)) suggestion = `Reserved address: ${reservedMeaning(address)}. A device answering here is unusual; check the wiring and the bus.`;
    else if (candidates.length === 0) suggestion = 'Not in this database. Probe ID or status registers with the I2C & SPI Bus Explorer and check the datasheet.';
    else if (candidates.length === 1 && idChecks.length === 1) suggestion = `Likely ${candidates[0].part}. Confirm: read ${idChecks[0].regHex} and expect ${formatValue(idChecks[0].expect, idChecks[0].width)}.`;
    else if (idChecks.length > 0) suggestion = 'Several parts share this address. Read the ID register below to tell them apart.';
    else suggestion = 'Several parts share this address and none has a known ID register here. Check the part on the board or use its datasheet.';
    return {
      address,
      hex: formatAddress(address),
      inUse: !!inUse,
      reserved: reservedMeaning(address),
      candidates: candidates.map((d) => ({ id: d.id, part: d.part, mfr: d.mfr, category: d.category })),
      idChecks,
      unverifiable,
      suggestion,
    };
  });
}

export function formatValue(value, width = 1) {
  const digits = width === 2 ? 4 : 2;
  return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
}
