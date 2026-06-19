import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeSentences } from "./segments";

export function useSpeechPlayer(segments, onProgress) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURIState] = useState("");
  const [speechError, setSpeechError] = useState("");
  const utteranceRef = useRef(null);
  const sentenceProgressRef = useRef(0);
  const progressTimerRef = useRef(null);
  const progressListenersRef = useRef(new Set());
  const stateRef = useRef({ segments, currentIndex, sentenceIndex, rate, voiceURI, isPlaying });

  const emitSentenceProgress = useCallback((progress) => {
    const next = Math.max(0, Math.min(1, progress));
    sentenceProgressRef.current = next;
    progressListenersRef.current.forEach((listener) => listener(next));
  }, []);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      window.cancelAnimationFrame(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const subscribeSentenceProgress = useCallback((listener) => {
    progressListenersRef.current.add(listener);
    listener(sentenceProgressRef.current);
    return () => progressListenersRef.current.delete(listener);
  }, []);

  useEffect(() => {
    stateRef.current = { segments, currentIndex, sentenceIndex, rate, voiceURI, isPlaying };
  }, [segments, currentIndex, sentenceIndex, rate, voiceURI, isPlaying]);

  useEffect(() => {
    const updateVoices = () => setVoices(window.speechSynthesis?.getVoices() || []);
    updateVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", updateVoices);
  }, []);

  useEffect(() => {
    if (!speechError) return undefined;
    const timer = window.setTimeout(() => setSpeechError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [speechError]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    clearProgressTimer();
    emitSentenceProgress(0);
    setIsPlaying(false);
  }, [clearProgressTimer, emitSentenceProgress]);

  const speakFrom = useCallback((segmentIndex, startSentence = 0) => {
    const segment = stateRef.current.segments[segmentIndex];
    if (!segment) return false;
    if (!segment.text?.trim()) {
      setIsPlaying(false);
      setSpeechError("当前页暂未完成识别。");
      return false;
    }
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setIsPlaying(false);
      setSpeechError("当前浏览器不支持系统语音，请使用 Chrome、Safari 或 Edge 打开。");
      return false;
    }
    setSpeechError("");
    const synthesis = window.speechSynthesis;
    const sentences = makeSentences(segment.text);
    const speakSentence = (index) => {
      const latest = stateRef.current;
      if (!latest.isPlaying || index >= sentences.length) {
        if (index >= sentences.length && segmentIndex < latest.segments.length - 1) {
          setCurrentIndex(segmentIndex + 1);
          setSentenceIndex(0);
          onProgress?.(segmentIndex + 1);
          window.setTimeout(() => speakFrom(segmentIndex + 1, 0), 80);
        } else {
          setIsPlaying(false);
        }
        return;
      }
      setSentenceIndex(index);
      const sentence = sentences[index];
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.rate = latest.rate;
      utterance.pitch = 1;
      utterance.volume = 1;
      const availableVoices = synthesis.getVoices();
      const selectedVoice = availableVoices.find(
        (voice) => voice.voiceURI === latest.voiceURI,
      )
        || availableVoices.find((voice) => /^zh-CN$/i.test(voice.lang))
        || availableVoices.find((voice) => /^zh/i.test(voice.lang))
        || voices.find((voice) => voice.voiceURI === latest.voiceURI);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.lang = selectedVoice?.lang || "zh-CN";
      utteranceRef.current = utterance;
      clearProgressTimer();
      emitSentenceProgress(0);
      const startedAt = performance.now();
      const estimatedDuration = Math.min(
        30_000,
        Math.max(1_200, (sentence.length / (5.2 * Math.max(0.5, latest.rate))) * 1_000),
      );
      const updateProgressFrame = () => {
        const estimatedProgress = ((performance.now() - startedAt) / estimatedDuration) * 0.94;
        emitSentenceProgress(Math.max(
          sentenceProgressRef.current,
          estimatedProgress,
        ));
        progressTimerRef.current = window.requestAnimationFrame(updateProgressFrame);
      };
      progressTimerRef.current = window.requestAnimationFrame(updateProgressFrame);
      utterance.onend = () => {
        clearProgressTimer();
        emitSentenceProgress(1);
        utteranceRef.current = null;
        window.setTimeout(() => speakSentence(index + 1), 60);
      };
      utterance.onerror = (event) => {
        clearProgressTimer();
        emitSentenceProgress(0);
        utteranceRef.current = null;
        if (event.error !== "canceled" && event.error !== "interrupted") {
          setIsPlaying(false);
          setSpeechError(`系统语音播放失败（${event.error || "未知错误"}），请尝试切换声音。`);
        }
      };
      synthesis.speak(utterance);
    };
    if (synthesis.speaking || synthesis.pending) {
      synthesis.cancel();
      window.setTimeout(() => speakSentence(startSentence), 80);
    } else {
      speakSentence(startSentence);
    }
    return true;
  }, [clearProgressTimer, emitSentenceProgress, onProgress, voices]);

  useEffect(() => () => {
    clearProgressTimer();
    window.speechSynthesis?.cancel();
  }, [clearProgressTimer]);

  const select = useCallback((index, autoplay = false) => {
    window.speechSynthesis?.cancel();
    clearProgressTimer();
    emitSentenceProgress(0);
    setSpeechError("");
    setCurrentIndex(index);
    setSentenceIndex(0);
    onProgress?.(index);
    setIsPlaying(autoplay);
    if (autoplay) {
      stateRef.current = { ...stateRef.current, currentIndex: index, sentenceIndex: 0, isPlaying: true };
      window.setTimeout(() => speakFrom(index, 0), 60);
    }
  }, [clearProgressTimer, emitSentenceProgress, onProgress, speakFrom]);

  const selectSentence = useCallback((index, requestedSentence, autoplay = true) => {
    const count = makeSentences(segments[index]?.text || "").length;
    const nextSentence = Math.max(0, Math.min(requestedSentence, Math.max(0, count - 1)));
    window.speechSynthesis?.cancel();
    clearProgressTimer();
    emitSentenceProgress(0);
    setSpeechError("");
    setCurrentIndex(index);
    setSentenceIndex(nextSentence);
    onProgress?.(index);
    setIsPlaying(autoplay);
    stateRef.current = {
      ...stateRef.current,
      currentIndex: index,
      sentenceIndex: nextSentence,
      isPlaying: autoplay,
    };
    if (autoplay) window.setTimeout(() => speakFrom(index, nextSentence), 60);
  }, [clearProgressTimer, emitSentenceProgress, onProgress, segments, speakFrom]);

  const load = useCallback((index = 0, autoplay = false) => {
    window.speechSynthesis?.cancel();
    clearProgressTimer();
    emitSentenceProgress(0);
    setSpeechError("");
    setCurrentIndex(index);
    setSentenceIndex(0);
    setIsPlaying(autoplay);
    if (autoplay) {
      stateRef.current = { ...stateRef.current, currentIndex: index, sentenceIndex: 0, isPlaying: true };
      window.setTimeout(() => speakFrom(index, 0), 60);
    }
  }, [clearProgressTimer, emitSentenceProgress, speakFrom]);

  const toggle = useCallback(() => {
    if (isPlaying) {
      stop();
      return;
    }
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setIsPlaying(false);
      setSpeechError("当前浏览器不支持系统语音，请使用 Chrome、Safari 或 Edge 打开。");
      return;
    }
    setSpeechError("");
    setIsPlaying(true);
    stateRef.current = { ...stateRef.current, isPlaying: true };
    speakFrom(currentIndex, sentenceIndex);
  }, [currentIndex, isPlaying, sentenceIndex, speakFrom, stop]);

  const previous = useCallback(() => select(Math.max(0, currentIndex - 1), isPlaying), [currentIndex, isPlaying, select]);
  const next = useCallback(() => select(Math.min(segments.length - 1, currentIndex + 1), isPlaying), [currentIndex, isPlaying, segments.length, select]);
  const skip = useCallback((direction) => {
    const count = makeSentences(segments[currentIndex]?.text || "").length;
    const nextSentence = Math.min(Math.max(0, sentenceIndex + direction), Math.max(0, count - 1));
    emitSentenceProgress(0);
    setSentenceIndex(nextSentence);
    if (isPlaying) {
      stateRef.current = { ...stateRef.current, sentenceIndex: nextSentence, isPlaying: true };
      speakFrom(currentIndex, nextSentence);
    }
  }, [currentIndex, emitSentenceProgress, isPlaying, segments, sentenceIndex, speakFrom]);

  const setRate = useCallback((nextRate) => {
    setRateState(nextRate);
    stateRef.current = { ...stateRef.current, rate: nextRate };
    if (isPlaying) window.setTimeout(() => speakFrom(currentIndex, sentenceIndex), 20);
  }, [currentIndex, isPlaying, sentenceIndex, speakFrom]);

  const setVoiceURI = useCallback((nextVoice) => {
    setSpeechError("");
    setVoiceURIState(nextVoice);
    stateRef.current = { ...stateRef.current, voiceURI: nextVoice };
    if (isPlaying) window.setTimeout(() => speakFrom(currentIndex, sentenceIndex), 20);
  }, [currentIndex, isPlaying, sentenceIndex, speakFrom]);

  const sentenceCount = useMemo(
    () => makeSentences(segments[currentIndex]?.text || "").length,
    [currentIndex, segments],
  );
  const sentenceCounts = useMemo(
    () => segments.map((segment) => makeSentences(segment.text || "").length),
    [segments],
  );
  const totalSentenceCount = useMemo(
    () => sentenceCounts.reduce((total, count) => total + count, 0),
    [sentenceCounts],
  );
  const completedSentenceCount = useMemo(
    () => sentenceCounts.slice(0, currentIndex).reduce((total, count) => total + count, 0) + sentenceIndex,
    [currentIndex, sentenceCounts, sentenceIndex],
  );
  const seekProgress = useCallback((globalSentenceIndex) => {
    let remaining = Math.max(0, Math.min(globalSentenceIndex, Math.max(0, totalSentenceCount - 1)));
    let targetSegment = 0;
    while (targetSegment < sentenceCounts.length - 1 && remaining >= sentenceCounts[targetSegment]) {
      remaining -= sentenceCounts[targetSegment];
      targetSegment += 1;
    }
    window.speechSynthesis?.cancel();
    clearProgressTimer();
    emitSentenceProgress(0);
    setCurrentIndex(targetSegment);
    setSentenceIndex(remaining);
    onProgress?.(targetSegment);
    if (isPlaying) {
      stateRef.current = {
        ...stateRef.current,
        currentIndex: targetSegment,
        sentenceIndex: remaining,
        isPlaying: true,
      };
      window.setTimeout(() => speakFrom(targetSegment, remaining), 40);
    }
  }, [clearProgressTimer, emitSentenceProgress, isPlaying, onProgress, sentenceCounts, speakFrom, totalSentenceCount]);

  const seekSentence = useCallback((nextSentenceIndex) => {
    const nextSentence = Math.max(
      0,
      Math.min(nextSentenceIndex, Math.max(0, sentenceCount - 1)),
    );
    window.speechSynthesis?.cancel();
    clearProgressTimer();
    emitSentenceProgress(0);
    setSentenceIndex(nextSentence);
    if (isPlaying) {
      stateRef.current = {
        ...stateRef.current,
        sentenceIndex: nextSentence,
        isPlaying: true,
      };
      window.setTimeout(() => speakFrom(currentIndex, nextSentence), 40);
    }
  }, [clearProgressTimer, currentIndex, emitSentenceProgress, isPlaying, sentenceCount, speakFrom]);

  return {
    currentIndex,
    sentenceIndex,
    sentenceCount,
    completedSentenceCount,
    totalSentenceCount,
    isPlaying,
    rate,
    voices,
    voiceURI,
    speechError,
    load,
    toggle,
    stop,
    select,
    selectSentence,
    previous,
    next,
    skip,
    setRate,
    setVoiceURI,
    seekProgress,
    seekSentence,
    subscribeSentenceProgress,
  };
}
