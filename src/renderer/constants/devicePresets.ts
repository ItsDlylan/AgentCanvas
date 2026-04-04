export interface DevicePreset {
  name: string
  width: number
  height: number
  mobile: boolean
  dpr: number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { name: 'iPhone 15', width: 393, height: 852, mobile: true, dpr: 3 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, mobile: true, dpr: 3 },
  { name: 'iPad', width: 820, height: 1180, mobile: true, dpr: 2 },
  { name: 'Pixel 8', width: 412, height: 924, mobile: true, dpr: 2.625 },
  { name: 'Desktop HD', width: 1440, height: 900, mobile: false, dpr: 1 },
  { name: 'Full HD', width: 1920, height: 1080, mobile: false, dpr: 1 },
  { name: 'Responsive', width: 0, height: 0, mobile: false, dpr: 0 }
]
