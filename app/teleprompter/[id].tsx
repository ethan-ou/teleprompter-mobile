import { db } from "@/db";
import { scripts } from "@/db/schema";
import { TeleprompterRecognizer, type Position } from "@/lib/recognizer";
import { getBoundsStart, resetTranscriptWindow } from "@/lib/speech-matcher";
import { getNextWordIndex, tokenize, type Token } from "@/lib/word-tokenizer";
import { Ionicons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [fontSize, setFontSize] = useState(32);
  const [align, setAlign] = useState<"top" | "center" | "bottom">("center");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [position, setPosition] = useState<Position>({
    start: -1,
    search: -1,
    end: -1,
    bounds: -1,
  });

  useEffect(() => {
    loadScript();

    // Lock to landscape mode when entering teleprompter
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch((err) =>
      console.warn("Could not lock orientation:", err)
    );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
              center: screenHeight * 0.5,
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
    }
  }, [script?.content]);

  const loadScript = useCallback(async () => {
    try {
      const result = await db
        .select()
        .from(scripts)
        .where(eq(scripts.id, Number(id)));

      if (result.length > 0) {
        setScript(result[0]);
      } else {
        Alert.alert("Error", "Script not found");
        router.back();
      }
    } catch (error) {
      console.error("Failed to load script:", error);
      Alert.alert("Error", "Failed to load script");
      router.back();
    }
  }, [id, router]);

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

  const adjustFontSize = (delta: number) => {
    setFontSize((prev) => Math.max(16, Math.min(72, prev + delta)));
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
      <View style={[styles.controlBar, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.controlButton} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        <View style={styles.centerControls}>
          <TouchableOpacity
            style={[styles.playButton, isPlaying && styles.playButtonActive]}
            onPress={togglePlayPause}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={32} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={resetScroll}>
            <Ionicons name="refresh-outline" size={28} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={() => adjustFontSize(-4)}>
            <Ionicons name="text-outline" size={20} color="#fff" />
            <Text style={styles.controlLabel}>-</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={() => adjustFontSize(4)}>
            <Ionicons name="text-outline" size={28} color="#fff" />
            <Text style={styles.controlLabel}>+</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              const alignments: ("top" | "center" | "bottom")[] = ["top", "center", "bottom"];
              const currentIndex = alignments.indexOf(align);
              setAlign(alignments[(currentIndex + 1) % alignments.length]);
            }}
          >
            <Ionicons
              name={align === "top" ? "chevron-up" : align === "center" ? "remove" : "chevron-down"}
              size={28}
              color="#fff"
            />
            <Text style={styles.controlLabel}>{align}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Script Content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isPlaying}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <View style={styles.scriptContainer}>
          <View style={styles.tokenWrapper}>
            {tokens.map((token, index) => {
              const isHighlighted =
                isPlaying && token.index <= position.end && token.index > position.start;
              const isCurrent = isPlaying && token.index === position.end;
              const isPast = isPlaying && token.index <= position.start;

              return (
                <View
                  key={token.index}
                  ref={(ref) => {
                    if (ref) {
                      tokenRefs.current.set(index, ref);
                    }
                  }}
                  style={styles.tokenContainer}
                >
                  <Text
                    style={[
                      styles.scriptText,
                      { fontSize },
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  centerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  controlButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: {
    color: "#fff",
    fontSize: 10,
    marginTop: 2,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
  },
  playButtonActive: {
    backgroundColor: "#FF3B30",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 100,
    paddingBottom: 200,
    paddingHorizontal: 40,
  },
  scriptContainer: {
    alignItems: "center",
  },
  tokenWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  tokenContainer: {
    flexDirection: "row",
  },
  scriptText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "500",
  },
  highlightedToken: {
    backgroundColor: "rgba(255, 215, 0, 0.3)",
  },
  currentToken: {
    backgroundColor: "rgba(255, 215, 0, 0.5)",
    fontWeight: "700",
  },
  pastToken: {
    color: "#666",
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
