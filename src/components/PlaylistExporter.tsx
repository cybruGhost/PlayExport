import { saveAs } from "file-saver"
import i18n from "../i18n/config"

import TracksData from "components/data/TracksData"
import TracksBaseData from "components/data/TracksBaseData"
import TracksArtistsData from "components/data/TracksArtistsData"
import TracksAudioFeaturesData from "components/data/TracksAudioFeaturesData"
import TracksAlbumData from "components/data/TracksAlbumData"

class TracksCsvFile {
  playlist: any
  trackItems: any
  columnNames: string[]
  lineData: Map<string, string[]>
  lineTrackUris: string[]
  lineTrackData: string[][]
  format: string // 'original' or 'custom'

  constructor(playlist: any, trackItems: any, format: string = 'original') {
    this.playlist = playlist
    this.trackItems = trackItems
    this.format = format
    
    if (format === 'custom') {
      // Custom format for your app
      this.columnNames = [
        'PlaylistBrowseId',
        'PlaylistName',
        'MediaId',
        'Title',
        'Artists',
        'Duration',
        'ThumbnailUrl',
        'AlbumId',
        'AlbumTitle',
        'ArtistIds'
      ]
    } else {
      // Original format - using i18n for backward compatibility
      this.columnNames = [
        i18n.t("track.added_by"),
        i18n.t("track.added_at")
      ]
    }

    this.lineData = new Map()
    this.lineTrackUris = trackItems.map((i: any) => i.track.uri)
    
    if (format === 'custom') {
      // Initialize with empty values for custom format
      this.lineTrackData = trackItems.map((i: any) => [
        '', // PlaylistBrowseId - will be filled later
        '', // PlaylistName - will be filled later
        i.track.id || '', // MediaId
        i.track.name || '', // Title
        '', // Artists - will be filled later
        this.formatDuration(i.track.duration_ms), // Duration
        this.getThumbnailUrl(i.track), // ThumbnailUrl
        i.track.album?.id || '', // AlbumId
        i.track.album?.name || '', // AlbumTitle
        '' // ArtistIds - will be filled later
      ])
    } else {
      // Original format
      this.lineTrackData = trackItems.map((i: any) => [
        i.added_by == null ? '' : i.added_by.uri,
        i.added_at
      ])
    }
  }

  // Helper method to format duration from ms to mm:ss
  formatDuration(ms: number): string {
    if (!ms) return '0:00'
    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(0)
    return `${minutes}:${seconds.padStart(2, '0')}`
  }

  // Helper method to get the best available thumbnail URL
  getThumbnailUrl(track: any): string {
    if (track.album?.images?.length > 0) {
      // Try to get medium size first, then small, then large
      return track.album.images.find((img: any) => img.height === 300)?.url ||
             track.album.images.find((img: any) => img.height === 64)?.url ||
             track.album.images[0]?.url ||
             ''
    }
    return ''
  }

  async addData(tracksData: TracksData, before = false) {
    if (this.format === 'custom') {
      // For custom format, we need to handle data differently
      const data: Map<string, string[]> = await tracksData.data()
      
      this.lineTrackUris.forEach((uri: string, index: number) => {
        if (data.has(uri)) {
          const trackData = data.get(uri)!
          
          if (tracksData instanceof TracksArtistsData) {
            // For artists data, we need to extract artist names and IDs
            const artistNames = trackData[0] || '' // Assuming first item is artist names
            const artistIds = trackData[1] || ''   // Assuming second item is artist IDs
            
            // Update the Artists and ArtistIds columns
            this.lineTrackData[index][4] = artistNames
            this.lineTrackData[index][9] = artistIds
          }
          // For other data types, we might need to map to different columns
          // This would need to be customized based on your TracksData implementations
        }
      })
    } else {
      // Original format logic
      if (before) {
        this.columnNames.unshift(...tracksData.dataLabels())
      } else {
        this.columnNames.push(...tracksData.dataLabels())
      }

      const data: Map<string, string[]> = await tracksData.data()

      this.lineTrackUris.forEach((uri: string, index: number) => {
        if (data.has(uri)) {
          if (before) {
            this.lineTrackData[index].unshift(...data.get(uri)!)
          } else {
            this.lineTrackData[index].push(...data.get(uri)!)
          }
        }
      })
    }
  }

  content(): string {
    let csvContent = ''

    // Add playlist info to each row for custom format
    if (this.format === 'custom') {
      const playlistId = this.playlist.id || ''
      const playlistName = this.playlist.name || ''
      
      this.lineTrackData.forEach((row) => {
        row[0] = playlistId      // PlaylistBrowseId
        row[1] = playlistName    // PlaylistName
      })
    }

    csvContent += this.columnNames.map(this.sanitize).join() + "\n"

    this.lineTrackData.forEach((lineTrackData) => {
      csvContent += lineTrackData.map(this.sanitize).join(",") + "\n"
    })

    return csvContent
  }

  sanitize(string: string): string {
    if (string === null || string === undefined) return '""'
    return '"' + String(string).replace(/"/g, '""') + '"'
  }
}

// Handles exporting a single playlist as a CSV file
class PlaylistExporter {
  accessToken: string
  playlist: any
  config: any
  format: string // 'original' or 'custom'

  constructor(accessToken: string, playlist: any, config: any, format: string = 'original') {
    this.accessToken = accessToken
    this.playlist = playlist
    this.config = config
    this.format = format
  }

  async export() {
    return this.csvData().then((data) => {
      const blob = new Blob([data], { type: "text/csv;charset=utf-8" })
      saveAs(blob, this.fileName(), { autoBom: false })
    })
  }

  async csvData() {
    const tracksBaseData = new TracksBaseData(this.accessToken, this.playlist)
    const items = await tracksBaseData.trackItems()
    const tracks = items.map(i => i.track)
    const tracksCsvFile = new TracksCsvFile(this.playlist, items, this.format)

    if (this.format === 'original') {
      // Add base data before existing (item) data, for backward compatibility
      await tracksCsvFile.addData(tracksBaseData, true)
    }

    if (this.config.includeArtistsData) {
      await tracksCsvFile.addData(new TracksArtistsData(this.accessToken, tracks))
    }

    if (this.config.includeAudioFeaturesData && this.format === 'original') {
      // Audio features might not be needed for custom format
      await tracksCsvFile.addData(new TracksAudioFeaturesData(this.accessToken, tracks))
    }

    if (this.config.includeAlbumData && this.format === 'original') {
      // Album data is already included in custom format
      await tracksCsvFile.addData(new TracksAlbumData(this.accessToken, tracks))
    }

    return tracksCsvFile.content()
  }

  fileName(withExtension = true): string {
    // Fixed ESLint warnings by using Unicode escape sequences and removing unnecessary escapes
    // eslint-disable-next-line no-control-regex
    const invalidChars = /[\u0000-\u001F\u007F/<>:"|?*[\]]+/g;
    const baseName = this.playlist.name.replace(invalidChars, "_").toLowerCase()
    return baseName + (this.format === 'custom' ? '_custom' : '') + (withExtension ? this.fileExtension() : "")
  }

  fileExtension(): string {
    return ".csv"
  }
}

// Factory function to create exporters with different formats
export function createPlaylistExporter(accessToken: string, playlist: any, config: any, format: string = 'original') {
  return new PlaylistExporter(accessToken, playlist, config, format)
}

export default PlaylistExporter