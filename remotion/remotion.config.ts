import { Config } from '@remotion/cli/config'

Config.setEntryPoint('./src/index.ts')
Config.setCachingEnabled(true)
Config.setCodec('h264')
Config.setPixelFormat('yuv420p')
Config.setVideoImageFormat('jpeg')
Config.setStillImageFormat('jpeg')
