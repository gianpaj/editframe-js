import fetch from 'cross-fetch'
import delay from 'delay'
import { Readable } from 'node:stream'
import open from 'open'
import ora from 'ora'
import prettyMilliseconds from 'pretty-ms'

import {
  ApiAudioMetadata,
  ApiImageMetadata,
  ApiInterface,
  ApiMetadataTypes,
  ApiVideo,
  ApiVideoMetadata,
  ApiVideoMetadataFormDataKey,
  ApiVideoMetadataKey,
  ApiVideoMetadataType,
  AudioKey,
  AudioLayer,
  AudioLayerConfig,
  AudioOptions,
  ChildKey,
  CompositionFile,
  CompositionInterface,
  CompositionMethod,
  CompositionOptions,
  Dimensions,
  EncodeResponse,
  FilterKey,
  FilterLayer,
  FilterOptionKey,
  Filters,
  FormDataInterface,
  HtmlKey,
  HtmlLayer,
  HtmlLayerConfig,
  HtmlOptions,
  IdentifiedFile,
  IdentifiedLayer,
  ImageLayer,
  ImageLayerConfig,
  LayerAttributeValue,
  LayerConfigs,
  LayerKey,
  LayerOptions,
  LayerType,
  LottieKey,
  LottieLayer,
  LottieLayerConfig,
  LottieOptions,
  Metadata,
  Routes,
  SequenceLayer,
  SequenceLayerConfig,
  SequenceableLayer,
  SubtitlesKey,
  SubtitlesLayer,
  SubtitlesLayerConfig,
  SubtitlesOptions,
  TextKey,
  TextLayer,
  TextLayerConfig,
  TextOptions,
  TypedLayer,
  VideoLayer,
  VideoLayerConfig,
  WaveformKey,
  WaveformLayer,
  WaveformLayerConfig,
  WaveformOptions,
  pollDelay,
} from 'constant'
import { Videos } from 'features'
import { Audio } from 'features/videos/layers/audio'
import { Filter } from 'features/videos/layers/filter'
import { Html } from 'features/videos/layers/html'
import { Image } from 'features/videos/layers/image'
import { Lottie } from 'features/videos/layers/lottie'
import { Sequence } from 'features/videos/layers/sequence'
import { Subtitles } from 'features/videos/layers/subtitles'
import { Text } from 'features/videos/layers/text'
import { Video } from 'features/videos/layers/video'
import { Waveform } from 'features/videos/layers/waveform'
import { CompositionErrorText } from 'strings'
import {
  createReadStream,
  createTemporaryDirectory,
  deepClone,
  deepMerge,
  formDataKey,
  getExtension,
  isAudioExtension,
  isEncodeResponse,
  isVideoExtension,
  metadataValidatorsByType,
  prepareFormData,
  preparePreview,
  processCompositionFile,
  processCrossfades,
  removeDirectory,
  sanitizeHtml,
  setLayerDefaults,
  translateColor,
  urlOrFile,
  uuid,
  validateApiData,
  validateAudioLayer,
  validateCompositionFile,
  validateCompositionOptions,
  validateFilterLayer,
  validateHtmlLayer,
  validateImageLayer,
  validateLottieLayer,
  validateOptions,
  validatePresenceOf,
  validateSequenceLayer,
  validateSubtitlesLayer,
  validateTextLayer,
  validateVideoLayer,
  validateWaveformLayer,
  withValidation,
  withValidationAsync,
} from 'utils'

export class Composition implements CompositionInterface {
  private _api: ApiInterface
  private _develop: boolean
  private _files: IdentifiedFile[]
  private _formData: FormDataInterface
  private _layers: IdentifiedLayer[] = []
  private _options: CompositionOptions
  private _temporaryDirectory: string
  private _videos: Videos

  constructor({
    api,
    develop = false,
    formData,
    options,
    temporaryDirectory,
    videos,
  }: {
    api: ApiInterface
    develop?: boolean
    formData: FormDataInterface
    options: CompositionOptions
    temporaryDirectory?: string
    videos: Videos
  }) {
    this._api = api
    this._develop = develop
    this._files = []
    this._formData = formData
    this._options = options
    this._temporaryDirectory = temporaryDirectory ?? createTemporaryDirectory()
    this._videos = videos

    withValidation<void>(() => validateCompositionOptions(this._options))
  }

  get [CompositionMethod.backgroundColor](): string {
    return this._options.backgroundColor
  }

  get [CompositionMethod.dimensions](): Dimensions {
    return this._options.dimensions
  }

  get [CompositionMethod.duration](): number {
    return this._options.duration
  }

  get [CompositionMethod.metadata](): Metadata {
    return this._options.metadata
  }

  get [CompositionMethod.layers](): IdentifiedLayer[] {
    return this._layers
  }

  public [CompositionMethod.layer](id: string): IdentifiedLayer {
    return this._layers.find((layer) => layer.id && layer.id === id)
  }

  public [CompositionMethod.getLayerAttribute]<AttributeValue>({
    childKey,
    id,
    layerKey,
  }: {
    childKey?: ChildKey
    id: string
    layerKey: LayerKey
  }): AttributeValue {
    const layerAttribute = this._layers.find((layer) => layer.id === id)[layerKey]

    return childKey ? layerAttribute[childKey] : layerAttribute
  }

  public [CompositionMethod.setLayerAttribute]({
    childKey,
    id,
    layerKey,
    value,
  }: {
    childKey?: ChildKey
    id: string
    layerKey: LayerKey
    value: LayerAttributeValue
  }): void {
    const newLayer = deepClone(this.layer(id))

    if (childKey) {
      newLayer[layerKey][childKey] = value
    } else {
      newLayer[layerKey] = value
    }

    this.setLayer(id, newLayer)
  }

  public async [CompositionMethod.addAudio](
    file: CompositionFile,
    options?: AudioOptions,
    layerConfig?: AudioLayerConfig
  ): Promise<Audio> {
    const audioLayer: AudioLayer = this._setLayerDefaults<AudioLayer>({
      layerConfig,
      layerType: LayerType.audio,
      options,
    })

    return withValidationAsync<Audio>(
      () => {
        validateCompositionFile(CompositionMethod.addAudio, file)
        validateOptions(CompositionMethod.addAudio, AudioKey, options)
        validateAudioLayer(CompositionMethod.addAudio, audioLayer)
      },
      async () => {
        const { id } = this._addLayer({ type: LayerType.audio, ...audioLayer })
        const { readStream } = await processCompositionFile(file, this._temporaryDirectory)

        this._files.push({ file: readStream, id })

        return new Audio({ composition: this, id })
      }
    )
  }

  public [CompositionMethod.addFilter]<FilterName extends keyof Filters>(options: {
    name: FilterName
    options?: Filters[FilterName]
  }): Filter | undefined {
    let filterLayer: FilterLayer = this._setLayerDefaults<FilterLayer>({
      layerType: LayerType.filter,
      options,
    })

    return withValidation<Filter>(
      () => {
        validatePresenceOf(options, CompositionErrorText.optionsRequired)
        validateOptions(CompositionMethod.addFilter, FilterKey, options)
        validateFilterLayer(CompositionMethod.addFilter, filterLayer)
      },
      () => {
        if (FilterOptionKey.color in options) {
          const transformedLayer: FilterLayer = deepClone(filterLayer)

          if (FilterOptionKey.color in transformedLayer.filter.options) {
            transformedLayer.filter.options.color = translateColor(transformedLayer.filter.options.color)
          }

          filterLayer = transformedLayer
        }

        const { id } = this._addLayer({ type: LayerType.filter, ...filterLayer })

        return new Filter({ composition: this, id })
      }
    )
  }

  public async [CompositionMethod.addHtml](options: HtmlOptions, layerConfig?: HtmlLayerConfig): Promise<Html> {
    const htmlLayer: HtmlLayer = this._setLayerDefaults<HtmlLayer>({
      layerConfig,
      layerType: LayerType.html,
      options,
    })

    return await withValidationAsync<Html>(
      () => {
        validatePresenceOf(options, CompositionErrorText.optionsRequired)
        validateOptions(CompositionMethod.addHtml, HtmlKey, options)
        validateHtmlLayer(CompositionMethod.addHtml, htmlLayer)
      },
      async () => {
        const {
          html: { page },
        } = htmlLayer
        const transformedLayer: HtmlLayer = deepClone(htmlLayer)

        if (page) {
          transformedLayer.html.page = await sanitizeHtml(page)
        }

        const { id } = this._addLayer({ type: LayerType.html, ...transformedLayer })

        return new Html({ composition: this, id })
      }
    )
  }

  public async [CompositionMethod.addImage](file: CompositionFile, layerConfig?: ImageLayerConfig): Promise<Image> {
    const imageLayer: ImageLayer = this._setLayerDefaults<ImageLayer>({ layerConfig, layerType: LayerType.image })

    return withValidationAsync<Image>(
      () => {
        validateCompositionFile(CompositionMethod.addImage, file)
        validateImageLayer(CompositionMethod.addImage, imageLayer)
      },
      async () => {
        const { id } = this._addLayer({ type: LayerType.image, ...imageLayer })
        const { readStream } = await processCompositionFile(file, this._temporaryDirectory)

        this._files.push({ file: readStream, id })

        return new Image({ composition: this, id })
      }
    )
  }

  public [CompositionMethod.addLottie](options: LottieOptions, layerConfig?: LottieLayerConfig): Lottie | undefined {
    const lottieLayer: LottieLayer = this._setLayerDefaults<LottieLayer>({
      layerConfig,
      layerType: LayerType.lottie,
      options,
    })

    return withValidation<Lottie>(
      () => {
        validatePresenceOf(options, CompositionErrorText.optionsRequired)
        validateOptions(CompositionMethod.addLottie, LottieKey, options)
        validateLottieLayer(CompositionMethod.addLottie, lottieLayer)
      },
      () => {
        const { id } = this._addLayer({ type: LayerType.lottie, ...lottieLayer })

        return new Lottie({ composition: this, id })
      }
    )
  }

  public async [CompositionMethod.addSequence](
    layers: SequenceableLayer[],
    layerConfig: SequenceLayerConfig = { timeline: { start: 0 } }
  ): Promise<Sequence> {
    const sequenceLayer: SequenceLayer = this._setLayerDefaults<SequenceLayer>({
      layerConfig,
      layerType: LayerType.sequence,
    })

    return await withValidationAsync<any>(
      () => {
        validateSequenceLayer(CompositionMethod.addSequence, sequenceLayer)
      },
      async () => {
        const layersWithDurationAndFilepath = await Promise.all(
          layers.map(async (layer) => {
            const layerFile = this._file(layer.id)
            let metadata: ApiAudioMetadata | ApiImageMetadata | ApiVideoMetadata
            let path: string

            if (layerFile) {
              const { filepath, readStream } = await processCompositionFile(layerFile.file, this._temporaryDirectory)
              const extension = getExtension(filepath)

              path = filepath

              if (isVideoExtension(extension)) {
                metadata = await this._getMetadata(readStream, ApiVideoMetadataType.video)
              } else if (isAudioExtension(extension)) {
                metadata = await this._getMetadata(readStream, ApiVideoMetadataType.audio)
              }
            }

            return {
              duration: metadata && ApiVideoMetadataKey.duration in metadata ? metadata.duration : undefined,
              filepath: path,
              layer,
            }
          })
        )

        let currentTime = sequenceLayer.timeline.start || 0

        layersWithDurationAndFilepath.map(({ duration, filepath, layer }, i) => {
          const { type } = layer
          const previousLayer = i > 0 ? layersWithDurationAndFilepath[i - 1].layer : undefined
          const nextLayer =
            i < layersWithDurationAndFilepath.length - 1 ? layersWithDurationAndFilepath[i + 1].layer : undefined

          currentTime = processCrossfades(currentTime, layer, previousLayer, nextLayer)

          if (filepath) {
            this._setFile(layer.id, createReadStream(filepath))
          }

          if (LayerKey.trim in layer) {
            const { end, start = 0 } = layer.trim

            if (end) {
              currentTime += end - start
            } else if (duration) {
              currentTime += duration - start
            } else {
              throw new Error(CompositionErrorText.trimEndRequired(type))
            }
          } else if (duration) {
            currentTime = duration
          } else {
            throw new Error(CompositionErrorText.trimEndRequired(type))
          }
        })

        this._setDuration(currentTime)

        const { id } = this._addLayer({ type: LayerType.sequence, ...sequenceLayer })

        return new Sequence({ composition: this, id, layers })
      }
    )
  }

  public async [CompositionMethod.addSubtitles](
    file: CompositionFile,
    options?: SubtitlesOptions,
    layerConfig?: SubtitlesLayerConfig
  ): Promise<Subtitles> {
    const subtitlesLayer: SubtitlesLayer = this._setLayerDefaults<SubtitlesLayer>({
      layerConfig,
      layerType: LayerType.subtitles,
      options,
    })

    return withValidationAsync<Subtitles>(
      () => {
        validateCompositionFile(CompositionMethod.addSubtitles, file)
        validateOptions(CompositionMethod.addSubtitles, SubtitlesKey, options)
        validateSubtitlesLayer(CompositionMethod.addSubtitles, subtitlesLayer)
      },
      async () => {
        const {
          subtitles: { backgroundColor, color },
        } = subtitlesLayer

        const transformedLayer: SubtitlesLayer = deepClone(subtitlesLayer)

        transformedLayer.subtitles.backgroundColor = translateColor(backgroundColor)
        transformedLayer.subtitles.color = translateColor(color)

        const { id } = this._addLayer({ type: LayerType.subtitles, ...transformedLayer })
        const { readStream } = await processCompositionFile(file, this._temporaryDirectory)

        this._files.push({ file: readStream, id })

        return new Subtitles({ composition: this, id })
      }
    )
  }

  public [CompositionMethod.addText](options: TextOptions, layerConfig?: TextLayerConfig): Text | undefined {
    const textLayer: TextLayer = this._setLayerDefaults<TextLayer>({
      layerConfig,
      layerType: LayerType.text,
      options,
    })

    return withValidation<Text>(
      () => {
        validatePresenceOf(options, CompositionErrorText.optionsRequired)
        validatePresenceOf(options.text, CompositionErrorText.textRequired)
        validateOptions(CompositionMethod.addText, TextKey, options)
        validateTextLayer(CompositionMethod.addText, textLayer)
      },
      () => {
        const {
          text: { backgroundColor, color },
        } = textLayer
        const transformedLayer: TextLayer = deepClone(textLayer)

        transformedLayer.text.backgroundColor = translateColor(backgroundColor)
        transformedLayer.text.color = translateColor(color)

        const { id } = this._addLayer({ type: LayerType.text, ...transformedLayer })

        return new Text({ composition: this, id })
      }
    )
  }

  public async [CompositionMethod.addVideo](file: CompositionFile, layerConfig?: VideoLayerConfig): Promise<Video> {
    const videoLayer: VideoLayer = this._setLayerDefaults<VideoLayer>({ layerConfig, layerType: LayerType.video })

    return withValidationAsync<Video>(
      () => {
        validateCompositionFile(CompositionMethod.addVideo, file)
        validateVideoLayer(CompositionMethod.addVideo, videoLayer)
      },
      async () => {
        const { id } = this._addLayer({ type: LayerType.video, ...videoLayer })
        const { readStream } = await processCompositionFile(file, this._temporaryDirectory)

        this._files.push({ file: readStream, id })

        return new Video({ composition: this, id })
      }
    )
  }

  public async [CompositionMethod.addWaveform](
    file?: CompositionFile,
    options?: WaveformOptions,
    layerConfig?: WaveformLayerConfig
  ): Promise<Waveform> {
    const waveformLayer: WaveformLayer = this._setLayerDefaults<WaveformLayer>({
      layerConfig,
      layerType: LayerType.waveform,
      options,
    })

    return withValidationAsync<Waveform>(
      () => {
        validateOptions(CompositionMethod.addWaveform, WaveformKey, options)
        validateWaveformLayer(CompositionMethod.addWaveform, waveformLayer)
        if (file) {
          validateCompositionFile(CompositionMethod.addWaveform, file)
        }
      },
      async () => {
        const {
          waveform: { backgroundColor, color },
        } = waveformLayer

        const transformedLayer: WaveformLayer = deepClone(waveformLayer)

        transformedLayer.waveform.backgroundColor = translateColor(backgroundColor)
        transformedLayer.waveform.color = translateColor(color)

        const { id } = this._addLayer({ type: LayerType.waveform, ...transformedLayer })

        if (file) {
          const { readStream } = await processCompositionFile(file, this._temporaryDirectory)

          this._files.push({ file: readStream, id })
        }

        return new Waveform({ composition: this, id })
      }
    )
  }

  public async [CompositionMethod.encode](options?: { synchronously?: false }): Promise<EncodeResponse>
  public async [CompositionMethod.encode](options?: { synchronously?: true }): Promise<ApiVideo>
  public async [CompositionMethod.encode]({ synchronously }: { synchronously?: boolean } = {}): Promise<
    ApiVideo | EncodeResponse
  > {
    let encodeResponse: EncodeResponse
    let encodeStartTime: Date
    let spinner: ora.Ora

    try {
      if (!this.duration) {
        throw new Error(CompositionErrorText.durationRequired)
      }

      this._generateConfig()

      if (this._develop) {
        spinner = ora('Uploading assets')
      }

      let data

      try {
        const requestStart = new Date()

        data = await this._api.post({ data: this._formData, isForm: true, url: Routes.videos.create })

        const requestEnd = new Date()

        if (this._develop) {
          spinner.succeed(`Assets uploaded in ${prettyMilliseconds(requestEnd.getTime() - requestStart.getTime())}`)
        }
      } catch (error) {
        if (this._develop) {
          spinner.fail('Asset upload failed')
        }

        throw error
      }

      encodeResponse = validateApiData<EncodeResponse>(data, {
        invalidDataError: CompositionErrorText.malformedEncodingResponse,
        validate: isEncodeResponse,
      })

      encodeStartTime = new Date()
    } catch (error) {
      console.error(CompositionErrorText.errorEncoding(error.message))

      return undefined
    } finally {
      removeDirectory(this._temporaryDirectory)
    }

    return synchronously ? this._getNewlyCreatedVideo({ encodeStartTime, videoId: encodeResponse.id }) : encodeResponse
  }

  public async [CompositionMethod.preview](): Promise<void> {
    await preparePreview(
      JSON.stringify({
        ...this._options,
        files: this._files,
        layers: this._layers,
      })
    )
  }

  private _addLayer(options: TypedLayer): IdentifiedLayer {
    const newLayer: IdentifiedLayer = deepMerge({ id: uuid() }, options)

    this._layers.push(newLayer)

    return newLayer
  }

  private _generateConfig(): void {
    this._files.forEach(({ file, id }) => this._formData.append(formDataKey(file, id), file))
    this._formData.append(
      'config',
      JSON.stringify({
        ...this._options,
        layers: this._layers.filter((layer) => layer.type !== LayerType.sequence),
      })
    )
  }

  private async [CompositionMethod.getMetadata](file: Readable, type: ApiVideoMetadataType): Promise<ApiMetadataTypes> {
    const formData = prepareFormData([
      [urlOrFile(file), file],
      [ApiVideoMetadataFormDataKey.type, type],
    ])

    const data = await this._api.post({ data: formData, isForm: true, url: Routes.metadata })

    return metadataValidatorsByType[type](data)
  }

  private _file(id: string): IdentifiedFile {
    return this._files.find((file) => file.id && file.id === id)
  }

  private [CompositionMethod.setDuration](duration: number): void {
    this._options.duration = duration
  }

  private [CompositionMethod.setFile](id: string, file: Readable): void {
    this._files.find((file) => file.id === id).file = file
  }

  private [CompositionMethod.setLayer](id: string, newLayer: IdentifiedLayer): void {
    const newLayers = deepClone(this.layers)
    const layerIndex = newLayers.findIndex((layer) => layer.id === id)

    newLayers[layerIndex] = newLayer

    this._layers = newLayers
  }

  /**
   * get a newly-created video which is likely still being encoded
   *
   * waits for encoding attempt to complete before returning
   *
   * in develop mode, outputs state to console and opens the video stream url when ready
   */
  private async _getNewlyCreatedVideo({
    encodeStartTime,
    videoId,
  }: {
    encodeStartTime: Date
    videoId: string
  }): Promise<ApiVideo> {
    let encodingSpinner: ora.Ora
    let video: ApiVideo

    if (this._develop) {
      encodingSpinner = ora('Encoding video').start()
    }

    try {
      video = await this._videos.get({ id: videoId, waitUntilEncodingComplete: true })
    } catch (error) {
      if (this._develop) {
        encodingSpinner.stop()
      }

      throw error
    }

    if (this._develop) {
      if (video.isFailed) {
        encodingSpinner.fail('Video encoding failed')
      } else if (video.isReady) {
        const encodeEndTime = new Date(video.timestamp * 1000)
        const encodeDuration = prettyMilliseconds(encodeEndTime.getTime() - encodeStartTime.getTime())

        encodingSpinner.succeed(`Video encoded in ${encodeDuration}`)

        const gettingSpinner = ora('Getting video').start()

        let streamResponse = await fetch(video.streamUrl)

        while (streamResponse.status !== 200) {
          await delay(pollDelay)

          streamResponse = await fetch(video.streamUrl)
        }

        gettingSpinner.stop()

        await open(video.streamUrl)
      }
    }

    return video
  }

  private _setLayerDefaults<Layer>({
    layerConfig,
    layerType,
    options,
  }: {
    layerConfig?: LayerConfigs
    layerType: LayerType
    options?: LayerOptions
  }): Layer {
    return setLayerDefaults<Layer>(this._options.dimensions, layerType, options, layerConfig)
  }
}
