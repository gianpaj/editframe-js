import { DefaultAudioOptions } from 'constant'
import { Videos } from 'features'
import { Composition } from 'features/videos/composition'
import { mockApi } from 'mocks'
import { makeDefaultAudioLayerConfig } from 'utils'

import { Audio } from './'

describe('Audio', () => {
  const defaultAudioLayerConfig = makeDefaultAudioLayerConfig()
  let composition: Composition
  let audio: Audio

  afterEach(() => {
    jest.clearAllMocks()
  })

  beforeEach(async () => {
    const api = mockApi({ get: jest.fn(), post: jest.fn(), put: jest.fn() })

    composition = new Composition({
      api,
      formData: { append: jest.fn() },
      options: { dimensions: { height: 1080, width: 1920 }, duration: 10 },
      videos: new Videos({ api }),
    })

    audio = await composition.addAudio('./package.json')

    jest.clearAllMocks()
  })

  describe('initialization', () => {
    it('sets the correct default layer configs', () => {
      expect(audio.volume).toEqual(DefaultAudioOptions.volume)
      expect(audio.start).toEqual(defaultAudioLayerConfig.timeline.start)
      expect(audio.trim).toEqual(defaultAudioLayerConfig.trim)
    })
  })
})
