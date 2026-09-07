/**
 * Speaking a brief instead of typing it.
 *
 * An event brief is two or three sentences of natural language — "a modern
 * corporate conference for five hundred, big stage, LED wall, round tables,
 * blue and white" — and that is far quicker to say than to type. It is also how
 * the people using this describe events to each other all day.
 *
 * ## Why the browser's own recogniser
 *
 * The Web Speech API is already in Chrome and Edge, needs no key, costs
 * nothing, and streams interim results so the words appear as they are spoken.
 * Sending audio to a server for transcription would be slower, would cost per
 * minute, and would need a microphone permission *and* an upload for a feature
 * whose entire value is that it is faster than typing. If the browser cannot do
 * it, the answer is to type — which is why `supported` is part of the contract
 * rather than an error.
 *
 * ## Continuous, and stopped by hand
 *
 * The recogniser ends a session on its own after a pause, which mid-sentence is
 * infuriating. It is restarted automatically until the user stops it, so a
 * thinking pause does not end the dictation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* The Web Speech API is not in the DOM lib, so the surface used is declared. */
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recogniser(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  /** Whether this browser can do it at all. */
  supported: boolean;
  listening: boolean;
  /** Words heard but not yet settled, for showing as they are spoken. */
  interim: string;
  /** Why it stopped, when it stopped badly. */
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Dictate into a text field.
 *
 * `onText` receives each settled phrase, so the caller appends rather than
 * replaces — dictation is added to what is already typed, which is what lets
 * someone type a sentence and then speak the rest of it.
 */
export function useDictation(onText: (phrase: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ref = useRef<SpeechRecognitionLike | null>(null);
  // Whether the user asked to stop, as opposed to the recogniser timing out.
  const wanted = useRef(false);
  // Kept in a ref so restarting does not need a fresh recogniser each time.
  const handler = useRef(onText);
  handler.current = onText;

  const supported = typeof window !== 'undefined' && recogniser() !== null;

  const stop = useCallback(() => {
    wanted.current = false;
    setListening(false);
    setInterim('');
    try {
      ref.current?.stop();
    } catch {
      // Already stopped. Nothing to do, and nothing worth telling anyone.
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = recogniser();
    if (!Ctor) return;

    setError(null);
    wanted.current = true;

    const instance = new Ctor();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || 'en-GB';

    instance.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0].transcript;
        if (result.isFinal) handler.current(text.trim());
        else pending += text;
      }
      setInterim(pending);
    };

    instance.onerror = (event) => {
      /*
       * `no-speech` and `aborted` are ordinary: a pause, or the user stopping.
       * Reporting them would put an error in front of someone who has done
       * nothing wrong. A denied microphone is worth saying out loud.
       */
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Novira needs permission to use the microphone.');
        wanted.current = false;
        setListening(false);
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError('Dictation stopped unexpectedly. Try again, or type it.');
      }
    };

    instance.onend = () => {
      // The recogniser ends on its own after a pause; restart unless the user
      // asked to stop, so thinking mid-sentence does not end the dictation.
      if (wanted.current) {
        try {
          instance.start();
          return;
        } catch {
          // Restart refused (usually a second start too quickly). Fall through.
        }
      }
      setListening(false);
      setInterim('');
    };

    ref.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      setError('Could not start dictation.');
      wanted.current = false;
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Leaving the panel while the microphone is live would keep listening.
  useEffect(
    () => () => {
      wanted.current = false;
      try {
        ref.current?.abort();
      } catch {
        // Nothing to abort.
      }
    },
    []
  );

  return { supported, listening, interim, error, start, stop, toggle };
}
