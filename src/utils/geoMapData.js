/**
 * Geographic Coastline Data, Airports & Tactical Flight Coordinates
 * Provides world landmass polygons, airports, and realistic ADS-B/AIS target trajectories.
 */

// Simplified World Continent & Coastline Polygons [lon, lat]
export const WORLD_COASTLINES = [
  // North America
  [
    [-168, 65], [-160, 71], [-140, 70], [-120, 69], [-85, 68], [-70, 60],
    [-55, 52], [-60, 46], [-66, 44], [-70, 42], [-75, 35], [-80, 25],
    [-82, 29], [-88, 30], [-97, 26], [-97, 20], [-87, 21], [-87, 14],
    [-83, 10], [-77, 8], [-80, 9], [-87, 13], [-96, 16], [-105, 20],
    [-110, 23], [-115, 30], [-122, 37], [-124, 46], [-130, 54], [-145, 60],
    [-160, 58], [-168, 65]
  ],
  // South America
  [
    [-77, 8], [-72, 11], [-62, 10], [-50, 0], [-35, -5], [-37, -12],
    [-40, -22], [-48, -28], [-57, -38], [-65, -52], [-74, -52], [-74, -42],
    [-71, -30], [-75, -15], [-80, -4], [-77, 8]
  ],
  // Europe & Asia (Eurasia)
  [
    [-9, 36], [-9, 43], [0, 46], [8, 54], [10, 58], [25, 71], [40, 68],
    [60, 70], [80, 73], [110, 75], [140, 72], [170, 67], [180, 65],
    [160, 54], [145, 45], [130, 38], [122, 30], [118, 24], [108, 18],
    [104, 10], [98, 8], [88, 22], [80, 10], [70, 22], [55, 25], [45, 12],
    [35, 30], [28, 41], [15, 40], [2, 42], [-5, 36], [-9, 36]
  ],
  // Africa
  [
    [-5, 36], [11, 37], [32, 31], [43, 12], [51, 10], [40, -5], [35, -20],
    [28, -33], [18, -34], [12, -18], [9, 4], [-15, 12], [-17, 21],
    [-10, 30], [-5, 36]
  ],
  // Australia
  [
    [114, -22], [122, -15], [132, -12], [142, -11], [146, -18], [153, -28],
    [150, -37], [140, -38], [135, -34], [125, -33], [115, -34], [114, -22]
  ],
  // British Isles
  [
    [-5, 50], [-2, 50], [1, 52], [0, 54], [-2, 57], [-5, 58], [-6, 55],
    [-4, 53], [-5, 50]
  ],
  // Japan
  [
    [130, 32], [135, 34], [140, 36], [141, 41], [144, 44], [141, 45],
    [138, 38], [132, 34], [130, 32]
  ]
];

// Major Airports & Waypoints [lon, lat, code, name]
export const AIRPORT_WAYPOINTS = [
  { code: 'SFO', name: 'San Francisco Int', lon: -122.375, lat: 37.619 },
  { code: 'LAX', name: 'Los Angeles Int', lon: -118.408, lat: 33.942 },
  { code: 'JFK', name: 'New York JFK', lon: -73.778, lat: 40.640 },
  { code: 'ORD', name: 'Chicago O\'Hare', lon: -87.907, lat: 41.974 },
  { code: 'MIA', name: 'Miami Int', lon: -80.290, lat: 25.795 },
  { code: 'SEA', name: 'Seattle-Tacoma', lon: -122.309, lat: 47.450 },
  { code: 'DFW', name: 'Dallas/Fort Worth', lon: -97.040, lat: 32.899 },
  { code: 'LHR', name: 'London Heathrow', lon: -0.454, lat: 51.470 },
  { code: 'CDG', name: 'Paris Charles de Gaulle', lon: 2.550, lat: 49.009 },
  { code: 'FRA', name: 'Frankfurt Airport', lon: 8.562, lat: 50.037 },
  { code: 'HND', name: 'Tokyo Haneda', lon: 139.781, lat: 35.549 }
];

// Active ADS-B Target Aircraft
export const INITIAL_AIRCRAFT_TARGETS = [
  {
    icao: 'A4B1C2',
    callsign: 'UAL421',
    type: 'B77W',
    desc: 'Boeing 777-300ER (United)',
    route: 'SFO → ORD',
    lat: 37.95,
    lon: -121.80,
    altFt: 34000,
    spdKts: 485,
    heading: 68,
    vSpd: 0,
    squawk: '1200',
    trail: [
      [-122.37, 37.62],
      [-122.15, 37.75],
      [-121.80, 37.95]
    ]
  },
  {
    icao: '3C67A1',
    callsign: 'DLH789',
    type: 'A359',
    desc: 'Airbus A350-900 (Lufthansa)',
    route: 'FRA → SFO',
    lat: 38.60,
    lon: -122.90,
    altFt: 18500,
    spdKts: 360,
    heading: 145,
    vSpd: -1800,
    squawk: '4210',
    trail: [
      [-123.40, 39.20],
      [-123.10, 38.90],
      [-122.90, 38.60]
    ]
  },
  {
    icao: 'A19F88',
    callsign: 'AAL102',
    type: 'B789',
    desc: 'Boeing 787-9 (American)',
    route: 'LAX → JFK',
    lat: 36.40,
    lon: -119.50,
    altFt: 37000,
    spdKts: 512,
    heading: 52,
    vSpd: 0,
    squawk: '3421',
    trail: [
      [-118.41, 33.94],
      [-118.90, 35.10],
      [-119.50, 36.40]
    ]
  },
  {
    icao: 'AB48E0',
    callsign: 'SWA2349',
    type: 'B38M',
    desc: 'Boeing 737 MAX 8 (Southwest)',
    route: 'OAK → PHX',
    lat: 37.10,
    lon: -121.40,
    altFt: 28000,
    spdKts: 430,
    heading: 122,
    vSpd: 800,
    squawk: '1400',
    trail: [
      [-122.22, 37.72],
      [-121.80, 37.40],
      [-121.40, 37.10]
    ]
  },
  {
    icao: '4005FA',
    callsign: 'BAW285',
    type: 'B772',
    desc: 'Boeing 777-200ER (British Airways)',
    route: 'LHR → SFO',
    lat: 39.10,
    lon: -121.90,
    altFt: 22000,
    spdKts: 395,
    heading: 210,
    vSpd: -1500,
    squawk: '5612',
    trail: [
      [-121.20, 39.80],
      [-121.60, 39.40],
      [-121.90, 39.10]
    ]
  },
  {
    icao: 'A9821F',
    callsign: 'MEDEVAC1',
    type: 'EC35',
    desc: 'Eurocopter EC135 (Life Flight)',
    route: 'CCR → SFO Med',
    lat: 37.85,
    lon: -122.45,
    altFt: 1800,
    spdKts: 125,
    heading: 185,
    vSpd: 0,
    squawk: '1200',
    trail: [
      [-122.05, 38.00],
      [-122.25, 37.92],
      [-122.45, 37.85]
    ]
  },
  {
    icao: 'AE01D4',
    callsign: 'REACH412',
    type: 'C17',
    desc: 'C-17 Globemaster III (USAF)',
    route: 'SUU → HIK',
    lat: 38.20,
    lon: -122.10,
    altFt: 29000,
    spdKts: 440,
    heading: 240,
    vSpd: 0,
    squawk: '7700', // Emergency squawk
    trail: [
      [-121.95, 38.27],
      [-122.10, 38.20]
    ]
  }
];

// Active AIS Marine Vessels
export const INITIAL_MARINE_VESSELS = [
  {
    mmsi: '353136000',
    name: 'EVER GIVEN',
    type: 'Container Ship',
    lengthM: 400,
    lat: 37.75,
    lon: -122.65,
    speedKts: 17.8,
    heading: 260,
    callsign: 'H3RC',
    dest: 'OAKLAND'
  },
  {
    mmsi: '538004123',
    name: 'PACIFIC VOYAGER',
    type: 'Crude Oil Tanker',
    lengthM: 274,
    lat: 37.88,
    lon: -122.50,
    speedKts: 11.2,
    heading: 75,
    callsign: 'V7AB2',
    dest: 'RICHMOND LONG WHARF'
  },
  {
    mmsi: '369854000',
    name: 'USCG BERTHOLF',
    type: 'National Security Cutter',
    lengthM: 127,
    lat: 37.78,
    lon: -122.35,
    speedKts: 21.5,
    heading: 310,
    callsign: 'NODD',
    dest: 'COAST GUARD ISLAND'
  }
];
