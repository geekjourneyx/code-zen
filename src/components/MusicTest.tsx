import { useState, useEffect } from 'react'
import { musicManager } from '@/lib/music'
import { Button } from '@/components/ui/button'

export function MusicTest() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(50)

  useEffect(() => {
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    window.addEventListener('music-play', handlePlay)
    window.addEventListener('music-pause', handlePause)

    // Initialize music manager
    musicManager.init({ enabled: true, volume: 50, autoPlay: false })

    return () => {
      window.removeEventListener('music-play', handlePlay)
      window.removeEventListener('music-pause', handlePause)
    }
  }, [])

  const handleToggle = () => {
    musicManager.toggle()
  }

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume)
    musicManager.setVolume(newVolume)
  }

  return (
    <div className="p-4 border rounded-lg space-y-4">
      <h3 className="text-lg font-semibold">Music Test</h3>
      
      <div className="flex items-center gap-4">
        <Button onClick={handleToggle}>
          {isPlaying ? '⏸️ Pause' : '▶️ Play'}
        </Button>
        
        <div className="flex items-center gap-2">
          <span className="text-sm">Volume:</span>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
            className="w-20"
          />
          <span className="text-sm w-8">{volume}%</span>
        </div>
      </div>
      
      <div className="text-sm text-muted-foreground">
        Status: {isPlaying ? 'Playing' : 'Paused'}
      </div>
    </div>
  )
}