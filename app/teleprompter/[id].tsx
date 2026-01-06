import { db } from "@/db";
import { scripts, settings } from "@/db/schema";
import { TeleprompterRecognizer, type Position } from "@/lib/recognizer";
import { getBoundsStart, resetTranscriptWindow } from "@/lib/speech-matcher";
import { getNextWordIndex, tokenize, type Token } from "@/lib/word-tokenizer";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Teleprompter() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const recognizerRef = useRef<TeleprompterRecognizer | null>(null);
  const tokenRefs = useRef<Map<number, View>>(new Map());

  const [script, setScript] = useState<any>(null);
  const { data: scriptData } = useLiveQuery(
    db
      .select()
      .from(scripts)
      .where(eq(scripts.id, Number(id)))
  );

  const { data: settingsData } = useLiveQuery(db.select().from(settings));

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

  useEffect(() => {
    if (scriptData) {
      if (scriptData.length > 0) {
        setScript(scriptData[0]);
      } else {
        Alert.alert("Error", "Script not found");
        router.back();
      }
    }
  }, [scriptData, router]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(true);
  const [orientationMode, setOrientationMode] = useState<"portrait" | "landscape" | "system">(
    "landscape"
  );
  const [mirror, setMirror] = useState(false);
  const [fontSize, setFontSize] = useState(32);
  const [margin, setMargin] = useState(10);
  const [align, setAlign] = useState<"top" | "center" | "bottom">("center");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [position, setPosition] = useState<Position>({
    start: -1,
    search: -1,
    end: -1,
    bounds: -1,
  });

  useEffect(() => {
    return () => {
      // Cleanup
      if (recognizerRef.current?.isRunning()) {
        recognizerRef.current.stop();
      }

      // Unlock orientation when leaving
      ScreenOrientation.unlockAsync().catch((err) =>
        console.warn("Could not unlock orientation:", err)
      );
    };
  }, [id]);

  // Handle orientation changes
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

  // Auto-scroll to highlighted word in voice mode
  useEffect(() => {
    if (isPlaying && position.end >= 0) {
      const nextWordIndex = getNextWordIndex(tokens, position.end);
      const tokenRef = tokenRefs.current.get(nextWordIndex);

      if (tokenRef) {
        tokenRef.measureLayout(
          scrollViewRef.current as any,
          (x, y) => {
            const screenHeight = Dimensions.get("window").height;

            // Calculate target position based on alignment
            const alignmentOffsets = {
              top: screenHeight * 0.1,
              center: screenHeight * 0.4,
              bottom: screenHeight * 0.75,
            };

            const targetY = y - alignmentOffsets[align];

            scrollViewRef.current?.scrollTo({
              y: Math.max(0, targetY),
              animated: true,
            });
          },
          () => {
            // Measurement failed, ignore
          }
        );
      }
    }
  }, [position.end, isPlaying, tokens, align]);

  // Tokenize script content
  useEffect(() => {
    if (script?.content) {
      const newTokens = tokenize(script.content);
      tokenRefs.current.clear();
      setTokens(newTokens);

      // Initialize recognizer
      if (recognizerRef.current) {
        recognizerRef.current.updateTokens(newTokens);
      } else {
        recognizerRef.current = new TeleprompterRecognizer(newTokens, {
          onPositionUpdate: (newPosition) => {
            setPosition(newPosition);
          },
          onError: (error) => {
            console.error("Speech recognition error:", error);
            Alert.alert("Voice Recognition Error", error.message || "An error occurred");
            setIsPlaying(false);
          },
          onEnd: () => {
            setIsPlaying(false);
          },
        });
      }

      // Clamp position to new token count to prevent out-of-bounds issues
      setPosition((prev) => ({
        start: Math.min(prev.start, newTokens.length - 1),
        search: Math.min(prev.search, newTokens.length - 1),
        end: Math.min(prev.end, newTokens.length - 1),
        bounds: Math.min(prev.bounds, newTokens.length - 1),
      }));
    }
  }, [script?.content]);

  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      // Stop voice recognition
      recognizerRef.current?.stop();
      setIsPlaying(false);
    } else {
      // Start voice recognition
      try {
        await recognizerRef.current?.start();
        setIsPlaying(true);
      } catch (error) {
        console.error("Failed to start voice recognition:", error);
        Alert.alert(
          "Voice Recognition Error",
          "Failed to start voice recognition. Please check microphone permissions."
        );
      }
    }
  }, [isPlaying]);

  const resetScroll = () => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    setIsPlaying(false);

    // Reset position
    const newPosition: Position = {
      start: -1,
      search: -1,
      end: -1,
      bounds: -1,
    };
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

  if (!script) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      {/* Control Bar */}
      {isMenuVisible && (
        <View style={[styles.controlBar, { paddingTop: insets.top + 8 }]}>
          {/* Group 0: Back */}
          <TouchableOpacity style={styles.controlButton} onPress={() => router.back()}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          {/* Group 1: Play, Reset, Edit */}
          <View style={styles.controlGroup}>
            <TouchableOpacity
              style={[styles.playButton, isPlaying && styles.playButtonActive]}
              onPress={togglePlayPause}
            >
              <Ionicons name={isPlaying ? "pause" : "play"} size={28} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlButton} onPress={resetScroll}>
              <Ionicons name="refresh-outline" size={24} color="#fff" />
              <Text style={styles.controlLabel}>Reset</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.controlButton}
              onPress={() => router.push(`/edit/${id}`)}
            >
              <Ionicons name="create-outline" size={24} color="#fff" />
              <Text style={styles.controlLabel}>Edit</Text>
            </TouchableOpacity>
          </View>

          {/* Group 2: Align, Orientation, Mirror */}
          <View style={styles.controlGroup}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={() => {
                const alignments: ("top" | "center" | "bottom")[] = ["top", "center", "bottom"];
                const currentIndex = alignments.indexOf(align);
                const nextAlign = alignments[(currentIndex + 1) % alignments.length];
                setAlign(nextAlign);
                updateSetting("align", nextAlign);
              }}
            >
              <Ionicons
                name={
                  align === "top" ? "chevron-up" : align === "center" ? "remove" : "chevron-down"
                }
                size={24}
                color="#fff"
              />
              <Text style={styles.controlLabel}>{align}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.controlButton}
              onPress={() => {
                const modes: ("portrait" | "landscape" | "system")[] = [
                  "portrait",
                  "landscape",
                  "system",
                ];
                const currentIndex = modes.indexOf(orientationMode);
                const nextMode = modes[(currentIndex + 1) % modes.length];
                setOrientationMode(nextMode);
                updateSetting("orientation", nextMode);
              }}
            >
              <Ionicons
                name={
                  orientationMode === "portrait"
                    ? "phone-portrait-outline"
                    : orientationMode === "landscape"
                    ? "phone-landscape-outline"
                    : "sync-outline"
                }
                size={24}
                color="#fff"
              />
              <Text style={styles.controlLabel}>{orientationMode}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlButton, mirror && styles.controlButtonActive]}
              onPress={() => {
                const nextVal = !mirror;
                setMirror(nextVal);
                updateSetting("mirror", nextVal);
              }}
            >
              <Ionicons name="swap-horizontal-outline" size={24} color="#fff" />
              <Text style={styles.controlLabel}>Mirror</Text>
            </TouchableOpacity>
          </View>

          {/* Group 3: Font size, Margin */}
          <View style={styles.controlGroup}>
            <View style={styles.stepperContainer}>
              <TouchableOpacity style={styles.controlButton} onPress={() => adjustFontSize(-4)}>
                <Ionicons name="remove-circle-outline" size={24} color="#fff" />
              </TouchableOpacity>
              <Ionicons name="text-outline" size={18} color="#fff" />
              <TouchableOpacity style={styles.controlButton} onPress={() => adjustFontSize(4)}>
                <Ionicons name="add-circle-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.stepperContainer}>
              <TouchableOpacity style={styles.controlButton} onPress={() => adjustMargin(-2)}>
                <Ionicons name="remove-circle-outline" size={24} color="#fff" />
              </TouchableOpacity>
              <MaterialCommunityIcons name="arrow-expand-horizontal" size={20} color="#fff" />
              <TouchableOpacity style={styles.controlButton} onPress={() => adjustMargin(2)}>
                <Ionicons name="add-circle-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.handleArea,
          !isMenuVisible && {
            position: "absolute",
            top: 0,
            zIndex: 100,
            paddingTop: insets.top,
            height: insets.top + 20,
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
        scrollEnabled={!isPlaying}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <View style={styles.scriptContainer}>
          <View style={styles.tokenWrapper}>
            {(() => {
              const lines: Token[][] = [];
              let currentLine: Token[] = [];
              tokens.forEach((token) => {
                if (token.value === "\n") {
                  lines.push(currentLine);
                  currentLine = [];
                } else {
                  currentLine.push(token);
                }
              });
              lines.push(currentLine);

              return lines.map((line, lineIndex) => (
                <View
                  key={lineIndex}
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    width: "100%",
                    minHeight: line.length === 0 ? fontSize + 10 : 0,
                  }}
                >
                  {line.map((token) => {
                    const isHighlighted =
                      isPlaying && token.index <= position.end && token.index > position.start;
                    const isCurrent = isPlaying && token.index === position.end;
                    const isPast = isPlaying && token.index <= position.start;

                    return (
                      <View
                        key={token.index}
                        ref={(ref) => {
                          if (ref) {
                            tokenRefs.current.set(token.index, ref);
                          }
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
              ));
            })()}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  controlBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    gap: 12,
  },
  controlGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  controlButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 40,
  },
  controlButtonActive: {
    opacity: 0.5,
  },
  controlLabel: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  playButtonActive: {
    backgroundColor: "#FF3B30",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 80,
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
    color: "#fff",
    textAlign: "left",
    fontFamily: "Inter_400Regular",
    // For some reason adding padding stops text from being cut off
    paddingHorizontal: 0.0001,
    backgroundColor: "transparent",
  },
  highlightedToken: {
    color: "#FFD700",
  },
  currentToken: {
    color: "#FFD700",
  },
  pastToken: {
    color: "#666",
  },
  handleArea: {
    width: "100%",
    height: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  handleBar: {
    width: 100,
    height: 5,
    borderRadius: 1.5,
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  guideLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#FF3B30",
    opacity: 0.5,
  },
});
