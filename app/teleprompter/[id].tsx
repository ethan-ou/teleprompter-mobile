import { db } from "@/db";
import { scripts, settings } from "@/db/schema";
import { TeleprompterRecognizer, type Position } from "@/lib/recognizer";
import { getBoundsStart, getTokensFromText, resetTranscriptWindow } from "@/lib/speech-matcher";
import { colors } from "@/lib/theme";
import { getNextWordIndex, tokenize, type Token } from "@/lib/word-tokenizer";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const KEEP_AWAKE_TAG = "teleprompter";

// Reconstruct a run of source text from its tokens (delimiters carry the spacing).
const joinTokens = (toks: Token[]) => toks.map((t) => t.value).join("");

// Geometry of one visual (wrapped) line within a paragraph.
type VisualLine = { y: number; words: number };

// Where the "reading line" sits as a fraction of screen height, per alignment.
const ALIGN_FRACTION: Record<"top" | "center" | "bottom", number> = {
  top: 0.1,
  center: 0.4,
  bottom: 0.75,
};

export default function Teleprompter() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollViewRef = useRef<ScrollView>(null);
  const recognizerRef = useRef<TeleprompterRecognizer | null>(null);
  // Text geometry, computed by the native text engine (no per-word views):
  //   paraYRef    — paragraph top Y (relative to the content), from onLayout
  //   paraLinesRef — per-paragraph wrapped-line geometry, from onTextLayout
  const paraYRef = useRef<Map<number, number>>(new Map());
  const paraLinesRef = useRef<Map<number, VisualLine[]>>(new Map());

  // 1. Script & Settings Data
  const { data: scriptData } = useLiveQuery(
    db
      .select()
      .from(scripts)
      .where(eq(scripts.id, Number(id)))
  );
  const script = scriptData?.[0] ?? null;

  const { data: settingsData } = useLiveQuery(db.select().from(settings));

  // 2. State
  const [isPlaying, setIsPlaying] = useState(false);

  // Engine warmed up on screen entry (permissions granted / model loaded).
  const [isReady, setIsReady] = useState(false);
  // True between tapping play and recognition actually going live.
  const [isStarting, setIsStarting] = useState(false);

  const [isMenuVisible, setIsMenuVisible] = useState(true);
  const [orientationMode, setOrientationMode] = useState<"portrait" | "landscape" | "system">(
    "landscape"
  );
  const [mirror, setMirror] = useState(false);
  const [fontSize, setFontSize] = useState(32);
  const [margin, setMargin] = useState(10);
  const [align, setAlign] = useState<"top" | "center" | "bottom">("center");
  const [position, setPosition] = useState<Position>({
    start: -1,
    search: -1,
    end: -1,
    bounds: -1,
  });

  // Screen-space position of the reading line, and the content top-padding that
  // lets the very first line scroll down to it (and the bottom-padding so the last
  // line can too). Geometry below is measured relative to this padded top.
  const readingOffset = windowHeight * ALIGN_FRACTION[align];

  // Scroll-to-reposition bookkeeping
  const scrollYRef = useRef(0);
  const userDraggingRef = useRef(false);
  const repositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate settings from DB
  useEffect(() => {
    if (settingsData) {
      settingsData.forEach((setting) => {
        switch (setting.name) {
          case "fontSize":
            setFontSize(Number(setting.value));
            break;
          case "margin":
            setMargin(Number(setting.value));
            break;
          case "mirror":
            setMirror(setting.value === "true");
            break;
          case "orientation":
            setOrientationMode(setting.value as any);
            break;
          case "align":
            setAlign(setting.value as any);
            break;
        }
      });
    }
  }, [settingsData]);

  // 3. Memoize Tokens + line structure (line -> first token index for repositioning)
  const tokens = useMemo(() => {
    if (!script?.content) return [];
    paraYRef.current.clear();
    paraLinesRef.current.clear();
    return tokenize(script.content);
  }, [script?.content]);

  const lines = useMemo(() => {
    const out: { tokens: Token[]; firstTokenIndex: number | null }[] = [];
    let current: Token[] = [];
    const flush = () => {
      const firstToken = current.find((t) => t.type === "TOKEN") ?? current[0];
      out.push({ tokens: current, firstTokenIndex: firstToken ? firstToken.index : null });
      current = [];
    };
    tokens.forEach((token) => {
      if (token.value === "\n") flush();
      else current.push(token);
    });
    flush();
    return out;
  }, [tokens]);

  // token index -> paragraph index
  const paragraphOfToken = useMemo(() => {
    const map = new Map<number, number>();
    lines.forEach((line, p) => line.tokens.forEach((t) => map.set(t.index, p)));
    return map;
  }, [lines]);

  // paragraph index -> its word (TOKEN) indices in order. Used to map a word to
  // its wrapped line (word counts from onTextLayout) for scrolling.
  const paragraphWords = useMemo(
    () => lines.map((line) => line.tokens.filter((t) => t.type === "TOKEN").map((t) => t.index)),
    [lines]
  );

  // Absolute content Y of the wrapped line containing a given word token.
  const tokenLineY = useCallback(
    (tokenIndex: number): number | undefined => {
      const p = paragraphOfToken.get(tokenIndex);
      if (p === undefined) return undefined;
      const paraY = paraYRef.current.get(p);
      const visualLines = paraLinesRef.current.get(p);
      const words = paragraphWords[p];
      if (paraY === undefined || !visualLines || !words) return undefined;
      const ordinal = words.indexOf(tokenIndex);
      if (ordinal < 0) return undefined;
      let counted = 0;
      for (const vl of visualLines) {
        if (ordinal < counted + vl.words) return readingOffset + paraY + vl.y;
        counted += vl.words;
      }
      const last = visualLines[visualLines.length - 1];
      return readingOffset + paraY + (last ? last.y : 0);
    },
    [paragraphOfToken, paragraphWords, readingOffset]
  );

  // 4. Update Recognizer when tokens change
  useEffect(() => {
    if (tokens.length === 0) return;

    if (recognizerRef.current) {
      recognizerRef.current.updateTokens(tokens);
    } else {
      recognizerRef.current = new TeleprompterRecognizer(
        tokens,
        {
          onReady: () => setIsReady(true),
          onStart: () => {
            // Recognition is actually live now.
            setIsStarting(false);
            setIsPlaying(true);
          },
          onPositionUpdate: setPosition,
          onError: (error) => {
            console.error("Speech recognition error:", error);
            Alert.alert("Voice Recognition Error", error.message || "An error occurred");
            setIsStarting(false);
            setIsPlaying(false);
          },
          onEnd: () => {
            setIsStarting(false);
            setIsPlaying(false);
          },
        },
        // Prefer the on-device model; recognizer falls back to the platform
        // engine if the model can't load.
        "sherpa"
      );
      // Warm up the engine now so play is instant (and the mic prompt happens
      // on entry, not on first tap).
      recognizerRef.current.prepare();
    }

    setPosition((prev) => ({
      start: Math.min(prev.start, tokens.length - 1),
      search: Math.min(prev.search, tokens.length - 1),
      end: Math.min(prev.end, tokens.length - 1),
      bounds: Math.min(prev.bounds, tokens.length - 1),
    }));
  }, [tokens]);

  // 5. Global Cleanup
  useEffect(() => {
    return () => {
      // Tear down the engine and free any loaded model on leave.
      recognizerRef.current?.dispose();
      ScreenOrientation.unlockAsync().catch((err) =>
        console.warn("Could not unlock orientation:", err)
      );
    };
  }, []);

  // 6. Keep the screen awake for the whole presenting session.
  //    Expo rejects activate() with "Unable to activate keep awake" when the
  //    Activity is momentarily unavailable (the screen/orientation transition as
  //    we enter), and on that failure the wake lock never engages — so the screen
  //    could sleep mid-presentation. Retry through that window and swallow the
  //    error in a try/catch so it can't surface as an unhandled rejection in dev.
  useEffect(() => {
    let cancelled = false;
    const enable = async (attempt = 0) => {
      try {
        await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      } catch {
        if (!cancelled && attempt < 4) {
          setTimeout(() => enable(attempt + 1), 200);
        }
      }
    };
    enable();
    return () => {
      cancelled = true;
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  // 7. Handle orientation changes
  useEffect(() => {
    const applyOrientation = async () => {
      try {
        if (orientationMode === "portrait") {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        } else if (orientationMode === "landscape") {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else {
          await ScreenOrientation.unlockAsync();
        }
      } catch (err) {
        console.warn("Could not set orientation:", err);
      }
    };

    applyOrientation();
  }, [orientationMode]);

  // 9. Auto-scroll to the wrapped line with the current word (suppressed while dragging).
  useEffect(() => {
    if (!isPlaying || position.end < 0 || userDraggingRef.current) return;

    const nextWordIndex = getNextWordIndex(tokens, position.end);
    const lineY = tokenLineY(nextWordIndex);
    if (lineY === undefined) return;

    const targetY = lineY - readingOffset;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, targetY), animated: true });
  }, [position.end, isPlaying, tokens, readingOffset, tokenLineY]);

  // Re-anchor the matcher to the wrapped line now at the reading line after a manual scroll.
  const repositionToReadingLine = useCallback(() => {
    const readingLineY = scrollYRef.current + readingOffset;

    let bestFirstToken: number | null = null;
    let bestY = -Infinity;
    paraLinesRef.current.forEach((visualLines, p) => {
      const paraY = paraYRef.current.get(p);
      const words = paragraphWords[p];
      if (paraY === undefined || !words) return;
      let counted = 0;
      for (const vl of visualLines) {
        const absY = readingOffset + paraY + vl.y;
        const firstToken = words[counted]; // first word on this wrapped line
        if (vl.words > 0 && firstToken !== undefined && absY <= readingLineY && absY > bestY) {
          bestY = absY;
          bestFirstToken = firstToken;
        }
        counted += vl.words;
      }
    });

    if (bestFirstToken === null) return;

    // Two overlapping states: the search anchor (where matching resumes) and the
    // read boundary (start/end, what gets dimmed). Anchor at the target word, but
    // set the read boundary to JUST BEFORE it so the target word is the next to
    // read — not pre-dimmed/"selected".
    const readBoundary = bestFirstToken - 1;
    const bounds = getBoundsStart(tokens, bestFirstToken);
    const newPosition: Position = {
      start: readBoundary,
      search: bestFirstToken,
      end: readBoundary,
      bounds: bounds ?? -1,
    };
    setPosition(newPosition);
    recognizerRef.current?.updatePosition(newPosition);
    resetTranscriptWindow();
    Haptics.selectionAsync().catch(() => {});
  }, [readingOffset, paragraphWords, tokens]);

  const handleScrollBeginDrag = () => {
    userDraggingRef.current = true;
    if (repositionTimer.current) clearTimeout(repositionTimer.current);
  };

  const finishUserScroll = () => {
    if (!userDraggingRef.current) return;
    userDraggingRef.current = false;
    repositionToReadingLine();
  };

  const handleScrollEndDrag = () => {
    // Fallback when the gesture ends with no momentum (onMomentumScrollEnd won't fire).
    if (repositionTimer.current) clearTimeout(repositionTimer.current);
    repositionTimer.current = setTimeout(finishUserScroll, 120);
  };

  const handleMomentumScrollEnd = () => {
    if (repositionTimer.current) clearTimeout(repositionTimer.current);
    finishUserScroll();
  };

  const startListening = useCallback(async () => {
    if (!recognizerRef.current?.isReady()) return; // not warmed up yet
    setIsStarting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      // isPlaying flips on the engine's onStart event (see recognizer callbacks).
      await recognizerRef.current?.start();
    } catch (error) {
      console.error("Failed to start voice recognition:", error);
      setIsStarting(false);
      Alert.alert(
        "Voice Recognition Error",
        "Failed to start voice recognition. Please check microphone permissions."
      );
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!isReady || isStarting) return; // not warmed up, or already starting
    if (isPlaying) {
      recognizerRef.current?.stop();
      setIsPlaying(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    startListening();
  }, [isPlaying, isReady, isStarting, startListening]);

  const resetScroll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    setIsPlaying(false);

    const newPosition: Position = { start: -1, search: -1, end: -1, bounds: -1 };
    setPosition(newPosition);

    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current.reset();
      const bounds = getBoundsStart(tokens, 0);
      if (bounds !== undefined) {
        const updatedPosition = { ...newPosition, bounds };
        setPosition(updatedPosition);
        recognizerRef.current.updatePosition(updatedPosition);
      }
    }
    resetTranscriptWindow();
  };

  const updateSetting = async (name: string, value: string | number | boolean) => {
    const val = String(value);
    await db
      .insert(settings)
      .values({ name, value: val })
      .onConflictDoUpdate({ target: settings.name, set: { value: val } });
  };

  const adjustFontSize = (delta: number) => {
    setFontSize((prev) => {
      const newVal = Math.max(16, Math.min(72, prev + delta));
      updateSetting("fontSize", newVal);
      return newVal;
    });
  };

  const adjustMargin = (delta: number) => {
    setMargin((prev) => {
      const newVal = Math.max(0, Math.min(40, prev + delta));
      updateSetting("margin", newVal);
      return newVal;
    });
  };

  const cycleAlign = () => {
    const order: ("top" | "center" | "bottom")[] = ["top", "center", "bottom"];
    const next = order[(order.indexOf(align) + 1) % order.length];
    setAlign(next);
    updateSetting("align", next);
    Haptics.selectionAsync().catch(() => {});
  };

  const cycleOrientation = () => {
    const order: ("portrait" | "landscape" | "system")[] = ["portrait", "landscape", "system"];
    const next = order[(order.indexOf(orientationMode) + 1) % order.length];
    setOrientationMode(next);
    updateSetting("orientation", next);
    Haptics.selectionAsync().catch(() => {});
  };

  const toggleMirror = () => {
    const next = !mirror;
    setMirror(next);
    updateSetting("mirror", next);
    Haptics.selectionAsync().catch(() => {});
  };

  if (!script) {
    // Brief DB fetch — show the black background, not a "Loading…" flash.
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Control Bar */}
      {isMenuVisible && (
        <View style={[styles.controlBar, { paddingTop: insets.top + 10 }]}>
          {/* Transport */}
          <View style={styles.group}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} hitSlop={6}>
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.playButton,
                isPlaying && styles.playButtonActive,
                (!isReady || isStarting) && styles.playButtonDisabled,
              ]}
              onPress={togglePlayPause}
              activeOpacity={0.85}
              disabled={!isReady || isStarting}
            >
              <Ionicons name={isPlaying ? "pause" : "play"} size={26} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.labelBtn} onPress={resetScroll} hitSlop={6}>
              <Ionicons name="refresh" size={22} color={colors.text} />
              <Text style={styles.btnLabel}>Reset</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.labelBtn}
              onPress={() => router.push(`/edit/${id}`)}
              hitSlop={6}
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
              <Text style={styles.btnLabel}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Layout */}
          <View style={styles.group}>
            <TouchableOpacity style={styles.labelBtn} onPress={cycleAlign} hitSlop={6}>
              <Ionicons
                name={align === "top" ? "chevron-up" : align === "center" ? "remove" : "chevron-down"}
                size={22}
                color={colors.text}
              />
              <Text style={styles.btnLabel}>{align}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.labelBtn} onPress={cycleOrientation} hitSlop={6}>
              <Ionicons
                name={
                  orientationMode === "portrait"
                    ? "phone-portrait-outline"
                    : orientationMode === "landscape"
                    ? "phone-landscape-outline"
                    : "sync-outline"
                }
                size={22}
                color={colors.text}
              />
              <Text style={styles.btnLabel}>{orientationMode}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.labelBtn, mirror && styles.labelBtnActive]}
              onPress={toggleMirror}
              hitSlop={6}
            >
              <Ionicons
                name="swap-horizontal-outline"
                size={22}
                color={mirror ? colors.accent : colors.text}
              />
              <Text style={[styles.btnLabel, mirror && styles.btnLabelActive]}>Mirror</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Text size & margin */}
          <View style={styles.group}>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustFontSize(-4)} hitSlop={6}>
                <Ionicons name="remove" size={20} color={colors.text} />
              </TouchableOpacity>
              <View style={styles.stepReadout}>
                <Ionicons name="text" size={16} color={colors.textMuted} />
                <Text style={styles.stepValue}>{fontSize}</Text>
              </View>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustFontSize(4)} hitSlop={6}>
                <Ionicons name="add" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustMargin(-2)} hitSlop={6}>
                <Ionicons name="remove" size={20} color={colors.text} />
              </TouchableOpacity>
              <View style={styles.stepReadout}>
                <MaterialCommunityIcons
                  name="arrow-expand-horizontal"
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={styles.stepValue}>{margin}</Text>
              </View>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustMargin(2)} hitSlop={6}>
                <Ionicons name="add" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Menu toggle handle */}
      <TouchableOpacity
        style={[
          styles.handleArea,
          !isMenuVisible && {
            position: "absolute",
            top: 0,
            zIndex: 100,
            paddingTop: insets.top,
            height: insets.top + 22,
          },
        ]}
        onPress={() => setIsMenuVisible(!isMenuVisible)}
        activeOpacity={0.7}
      >
        <View style={styles.handleBar} />
      </TouchableOpacity>

      {/* Script Content */}
      <ScrollView
        ref={scrollViewRef}
        style={[styles.scrollView, mirror && { transform: [{ scaleX: -1 }] }]}
        contentContainerStyle={[
          {
            // Top/bottom padding so the first and last lines can reach the reading line.
            paddingTop: readingOffset,
            paddingBottom: windowHeight - readingOffset + 80,
            paddingLeft: `${margin}%`,
            paddingRight: `${margin * 0.8 - Math.min(fontSize / 80, 1) * 0.4}%`,
          },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
      >
        <View style={styles.scriptContainer}>
          <View style={styles.tokenWrapper}>
            {lines.map((line, p) => {
              const setParaY = (e: LayoutChangeEvent) =>
                paraYRef.current.set(p, e.nativeEvent.layout.y);
              const setParaLines = (e: NativeSyntheticEvent<TextLayoutEventData>) =>
                paraLinesRef.current.set(
                  p,
                  e.nativeEvent.lines.map((l) => ({ y: l.y, words: getTokensFromText(l.text).length }))
                );

              // Blank line (paragraph break) — a spacer that still records its Y.
              if (line.tokens.length === 0) {
                return <View key={p} onLayout={setParaY} style={{ height: fontSize + 10 }} />;
              }

              const lineStyle = [styles.scriptText, { fontSize, lineHeight: fontSize + 10 }];
              const firstTok = line.tokens[0].index;
              const lastTok = line.tokens[line.tokens.length - 1].index;

              // Dim-past / bright-ahead: everything already spoken — including words
              // matched in the live partial (index <= end) — is dimmed; only upcoming
              // text stays bright. The grey→white boundary is the position cue.
              const straddles =
                isPlaying && firstTok <= position.end && lastTok > position.end;

              // Whole paragraph one colour (cheap single string) unless it straddles
              // the read boundary.
              if (!straddles) {
                const fullyPast = isPlaying && lastTok <= position.end;
                return (
                  <Text
                    key={p}
                    onLayout={setParaY}
                    onTextLayout={setParaLines}
                    style={[...lineStyle, fullyPast && styles.pastToken]}
                  >
                    {joinTokens(line.tokens)}
                  </Text>
                );
              }

              // Straddling paragraph: a dim run (spoken) + a bright run (upcoming).
              const past: Token[] = [];
              const ahead: Token[] = [];
              for (const t of line.tokens) {
                if (t.index <= position.end) past.push(t);
                else ahead.push(t);
              }

              return (
                <Text key={p} onLayout={setParaY} onTextLayout={setParaLines} style={lineStyle}>
                  {past.length > 0 && <Text style={styles.pastToken}>{joinTokens(past)}</Text>}
                  {ahead.length > 0 && <Text>{joinTokens(ahead)}</Text>}
                </Text>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  controlBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: "rgba(10,10,10,0.92)",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  divider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 4,
    backgroundColor: colors.border,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  labelBtn: {
    minWidth: 52,
    height: 44,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  labelBtnActive: {
    backgroundColor: "rgba(10,132,255,0.15)",
  },
  btnLabel: {
    color: colors.text,
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    textTransform: "capitalize",
  },
  btnLabelActive: {
    color: colors.accent,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  playButtonActive: {
    backgroundColor: colors.danger,
  },
  playButtonDisabled: {
    backgroundColor: colors.surfaceElevated,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepBtn: {
    width: 38,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  stepReadout: {
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  stepValue: {
    color: colors.text,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  handleArea: {
    width: "100%",
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  handleBar: {
    width: 100,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  scrollView: {
    flex: 1,
  },
  scriptContainer: {
    alignItems: "flex-start",
    width: "100%",
  },
  tokenWrapper: {
    width: "100%",
  },
  scriptText: {
    width: "100%",
    color: colors.text,
    textAlign: "left",
    fontFamily: "Inter_400Regular",
  },
  highlightedToken: {
    color: colors.highlight,
  },
  currentToken: {
    color: "#000",
    backgroundColor: colors.highlight,
    borderRadius: 4,
  },
  pastToken: {
    color: colors.textFaint,
  },
});
