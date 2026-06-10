import { db } from "@/db";
import { scripts, settings } from "@/db/schema";
import { TeleprompterRecognizer, type Position } from "@/lib/recognizer";
import { getBoundsStart, resetTranscriptWindow } from "@/lib/speech-matcher";
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
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const KEEP_AWAKE_TAG = "teleprompter";
const SCROLL_TOP_PADDING = 80; // keep in sync with styles.scrollContent.paddingTop

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
  const tokenRefs = useRef<Map<number, View>>(new Map());

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
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

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

  // Scroll-to-reposition bookkeeping
  const scrollYRef = useRef(0);
  const userDraggingRef = useRef(false);
  const repositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineYRef = useRef<Map<number, number>>(new Map());

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
    tokenRefs.current.clear();
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

  // 4. Update Recognizer when tokens change
  useEffect(() => {
    if (tokens.length === 0) return;

    if (recognizerRef.current) {
      recognizerRef.current.updateTokens(tokens);
    } else {
      recognizerRef.current = new TeleprompterRecognizer(tokens, {
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
      });
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
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      ScreenOrientation.unlockAsync().catch((err) =>
        console.warn("Could not unlock orientation:", err)
      );
    };
  }, []);

  // 6. Keep the screen awake only while presenting
  useEffect(() => {
    if (isPlaying) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
  }, [isPlaying]);

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

  // 9. Auto-scroll to highlighted word in voice mode (suppressed while the user drags)
  useEffect(() => {
    if (!isPlaying || position.end < 0 || userDraggingRef.current) return;

    const nextWordIndex = getNextWordIndex(tokens, position.end);
    const tokenRef = tokenRefs.current.get(nextWordIndex);
    if (!tokenRef) return;

    tokenRef.measureLayout(
      scrollViewRef.current as any,
      (x, y) => {
        if (!isPlayingRef.current || userDraggingRef.current) return;
        const targetY = y - windowHeight * ALIGN_FRACTION[align];
        scrollViewRef.current?.scrollTo({ y: Math.max(0, targetY), animated: true });
      },
      () => {}
    );
  }, [position.end, isPlaying, tokens, align, windowHeight]);

  // Re-anchor the matcher to whatever line is now at the reading line after a manual scroll.
  const repositionToReadingLine = useCallback(() => {
    const readingLineY = scrollYRef.current + windowHeight * ALIGN_FRACTION[align];

    let bestLine: number | null = null;
    let bestY = -Infinity;
    lineYRef.current.forEach((y, lineIndex) => {
      const absY = y + SCROLL_TOP_PADDING;
      if (absY <= readingLineY && absY > bestY) {
        bestY = absY;
        bestLine = lineIndex;
      }
    });

    if (bestLine === null) return;
    const firstTokenIndex = lines[bestLine]?.firstTokenIndex;
    if (firstTokenIndex == null) return;

    const bounds = getBoundsStart(tokens, firstTokenIndex);
    const newPosition: Position = {
      start: firstTokenIndex,
      search: firstTokenIndex,
      end: firstTokenIndex,
      bounds: bounds ?? -1,
    };
    setPosition(newPosition);
    recognizerRef.current?.updatePosition(newPosition);
    resetTranscriptWindow();
    Haptics.selectionAsync().catch(() => {});
  }, [align, windowHeight, lines, tokens]);

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
          styles.scrollContent,
          {
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
            {lines.map((line, lineIndex) => (
              <View
                key={lineIndex}
                onLayout={(e) => {
                  lineYRef.current.set(lineIndex, e.nativeEvent.layout.y);
                }}
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  width: "100%",
                  minHeight: line.tokens.length === 0 ? fontSize + 10 : 0,
                }}
              >
                {line.tokens.map((token) => {
                  const isHighlighted =
                    isPlaying && token.index <= position.end && token.index > position.start;
                  const isCurrent = isPlaying && token.index === position.end;
                  const isPast = isPlaying && token.index <= position.start;

                  return (
                    <View
                      key={token.index}
                      ref={(ref) => {
                        if (ref) tokenRefs.current.set(token.index, ref);
                      }}
                      style={styles.tokenContainer}
                    >
                      <Text
                        style={[
                          styles.scriptText,
                          { fontSize, lineHeight: fontSize + 10 },
                          isPast && styles.pastToken,
                          isHighlighted && styles.highlightedToken,
                          isCurrent && styles.currentToken,
                        ]}
                      >
                        {token.value}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
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
  scrollContent: {
    paddingTop: SCROLL_TOP_PADDING,
    paddingBottom: 200,
  },
  scriptContainer: {
    alignItems: "flex-start",
  },
  tokenWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  tokenContainer: {
    flexDirection: "row",
  },
  scriptText: {
    color: colors.text,
    textAlign: "left",
    fontFamily: "Inter_400Regular",
    // For some reason adding padding stops text from being cut off
    paddingHorizontal: 0.0001,
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
