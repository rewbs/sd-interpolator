import { Button } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.js";
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import SpectrogramPlugin from "wavesurfer.js/dist/plugins/spectrogram.js";
import { CssVarsPalette, Palette, SupportedColorScheme, experimental_extendTheme as extendTheme, useColorScheme } from "@mui/material/styles";
import { themeFactory } from "../theme";
import { channelToRgba } from '../utils/utils';
import {useHotkeys} from 'react-hotkeys-hook';

interface WavesurferAudioWaveformProps {
  audioBuffer: AudioBuffer;
  initialSelection: { start: number, end: number }
  onSelectionChange: (start: number, end: number) => void;
}

// Used by the timeseries extractor
// TODO: merge with AudioWaveform.tsx
const WavesurferAudioWaveform = ({ audioBuffer, initialSelection, onSelectionChange }: WavesurferAudioWaveformProps) => {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [playbackStart, setPlaybackStart] = useState<number>(initialSelection.start);
  const [isPlaying, setIsPlaying] = useState(false);

  const theme = extendTheme(themeFactory());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {colorScheme, setColorScheme }  = useColorScheme();
  const palette = theme.colorSchemes[(colorScheme||'light') as SupportedColorScheme].palette;
  const [prevAudioBuffer, setPrevAudioBuffer] = useState<AudioBuffer | undefined>();
  const [prevPalette, setPrevPalette] = useState<Palette & CssVarsPalette>();

  useEffect(() => {

    // Recreate wavesurfer iff the audio buffer or color scheme has changed
    if (audioBuffer !== prevAudioBuffer || palette.mode !== prevPalette?.mode) {
      if (waveSurferRef.current) {
        waveSurferRef.current.destroy();
        waveSurferRef.current = null;
      }
      setPrevAudioBuffer(audioBuffer);
      setPrevPalette(palette);
    }

    if (waveformRef.current && timelineRef.current  && !waveSurferRef.current) {

      const regionsPlugin = RegionsPlugin.create();
      const timelinePlugin = TimelinePlugin.create({
        container: timelineRef.current,
        // unlabeledNotchColor: palette.graphBorder.main,
        // primaryColor: palette.graphBorder.dark,
        // secondaryColor: palette.graphBorder.light,
        // primaryFontColor: palette.graphFont.main,
        // secondaryFontColor: palette.graphFont.light,            
      });
      const spectrogramPlugin = SpectrogramPlugin.create({
        container: "#spectrogram_dialog",
        labels: true,
        height: 75,
        //colorMap: colormap
      });

      const wavesurfer = WaveSurfer.create({
        container: waveformRef.current,
        normalize: true,
        cursorColor: palette.success.light,
        cursorWidth: 3,
        waveColor: [palette.waveformStart.main, palette.waveformEnd.main],
        progressColor: [palette.waveformProgressMaskStart.main, palette.waveformProgressMaskEnd.main],
        plugins: [
          regionsPlugin,
          timelinePlugin,
          spectrogramPlugin
        ],
      });

      waveSurferRef.current = wavesurfer;

      wavesurfer.on("ready", () => {
        console.log("WaveSurfer is ready");
        if (waveSurferRef.current) {
          regionsPlugin.addRegion({
            start: initialSelection.start/1000,
            end: Math.min(initialSelection.end/1000, waveSurferRef.current.getDuration()),
            //loop: false,
            drag: true,
            resize: false,
            color: channelToRgba(palette.primary.mainChannel, 0.3),
          })
          setIsPlaying(false);
        }
      });
      wavesurfer.on("finish", () => {
        setIsPlaying(false);
      });      
      regionsPlugin.on('region-created', (region: any) => {
        const newStart = Math.floor(region.start * 1000);
        const newEnd = Math.floor(region.end * 1000);
        onSelectionChange(newStart, newEnd);
        setPlaybackStart(region.start);
      });
      regionsPlugin.on('region-updated', (region: any) => {
        const newStart = Math.floor(region.start * 1000);
        const newEnd = Math.floor(region.end * 1000);
        onSelectionChange(newStart, newEnd);
        setPlaybackStart(region.start);
      });

      
      wavesurfer.load("", [audioBuffer.getChannelData(0)]);
  

    }

  }, [audioBuffer, initialSelection, onSelectionChange, prevPalette, palette, prevAudioBuffer]);



  function playPause(from : number = -1, pauseIfPlaying = true) {
    if (isPlaying && pauseIfPlaying) {
      waveSurferRef.current?.pause();
    } else {
        if (from>=0) {
          waveSurferRef.current?.setTime(from);
        } if (!isPlaying) {
          waveSurferRef.current?.play();
        }
    }
    setIsPlaying(waveSurferRef.current?.isPlaying() ?? false );
  }

  useHotkeys('space',
    () => playPause(),
    {preventDefault:true, scopes:['timeseries']},
    [playPause]);

  useHotkeys('shift+space',
    () => playPause(playbackStart??0, false),
    {preventDefault:true, scopes:['timeseries']},
    [playPause, playbackStart]);

  useHotkeys('ctrl+space',
    () => playPause(0, false),
    {preventDefault:true, scopes:['timeseries']},
    [playPause]);    

  return (
    <div>
      <div ref={waveformRef} id="waveform_dialog" />
      <div ref={timelineRef} id="timeline_dialog" />
      <div id="spectrogram_dialog" />
      <Button size="small" variant='outlined' onClick={(e) => playPause(playbackStart??0)}>
        {isPlaying ? "⏸️ Pause" : "▶️ Play"}
      </Button>
    </div>
  );
};

export default WavesurferAudioWaveform;