import { convertFileSrc } from '@tauri-apps/api/core'

export interface MusicSettings {
  enabled: boolean
  volume: number
  autoPlay: boolean
}

class MusicManager {
  private audio: HTMLAudioElement | null = null
  private settings: MusicSettings = {
    enabled: false,
    volume: 50,
    autoPlay: true
  }
  private isInitialized = false
  private isPlaying = false

  async init(settings?: MusicSettings) {
    if (this.isInitialized) return

    try {
      // 通过 Tauri asset protocol 加载音频文件
      const audioUrl = await convertFileSrc('resources/music/ADHD_01.mp3')
      this.audio = new Audio(audioUrl)
      this.audio.loop = true
      this.audio.preload = 'auto'
      
      // 设置音频事件监听
      this.audio.addEventListener('loadeddata', () => {
        console.log('Music loaded successfully')
      })
      
      this.audio.addEventListener('error', (e) => {
        console.warn('Music loading error:', e)
      })

      this.audio.addEventListener('play', () => {
        this.isPlaying = true
        this.dispatchEvent('music-play')
      })

      this.audio.addEventListener('pause', () => {
        this.isPlaying = false
        this.dispatchEvent('music-pause')
      })

      if (settings) {
        this.updateSettings(settings)
      }

      this.isInitialized = true
    } catch (error) {
      console.warn('Music initialization failed:', error)
    }
  }

  updateSettings(settings: Partial<MusicSettings>) {
    this.settings = { ...this.settings, ...settings }
    
    if (this.audio) {
      this.audio.volume = this.settings.volume / 100
    }

    // 如果禁用音乐，停止播放
    if (!this.settings.enabled && this.isPlaying) {
      this.pause()
    }
  }

  async play() {
    if (!this.audio || !this.settings.enabled) return

    try {
      await this.audio.play()
    } catch (error) {
      console.warn('Music play failed:', error)
      // 可能是由于浏览器的自动播放策略
    }
  }

  pause() {
    if (this.audio) {
      this.audio.pause()
    }
  }

  toggle() {
    if (this.isPlaying) {
      this.pause()
    } else {
      this.play()
    }
  }

  setVolume(volume: number) {
    const clampedVolume = Math.max(0, Math.min(100, volume))
    this.settings.volume = clampedVolume
    
    if (this.audio) {
      this.audio.volume = clampedVolume / 100
    }
  }

  getSettings(): MusicSettings {
    return { ...this.settings }
  }

  getIsPlaying(): boolean {
    return this.isPlaying
  }

  private dispatchEvent(eventName: string) {
    window.dispatchEvent(new CustomEvent(eventName))
  }
}

export const musicManager = new MusicManager()