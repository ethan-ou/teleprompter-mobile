import { db } from "@/db";
import { scripts } from "@/db/schema";
import { Ionicons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function Teleprompter() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const [script, setScript] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(50);
  const [fontSize, setFontSize] = useState(32);
  const [scrollPosition, setScrollPosition] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadScript();

    // Lock to landscape mode when entering teleprompter
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch((err) =>
      console.warn("Could not lock orientation:", err)
    );

    return () => {
      // Unlock orientation when leaving
      ScreenOrientation.unlockAsync().catch((err) =>
        console.warn("Could not unlock orientation:", err)
      );
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [id]);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setScrollPosition((prev) => {
          const newPosition = prev + speed / 10;
          scrollViewRef.current?.scrollTo({
            y: newPosition,
            animated: false,
          });
          return newPosition;
        });
      }, 50);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, speed]);

  const loadScript = async () => {
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
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const resetScroll = () => {
    setScrollPosition(0);
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    setIsPlaying(false);
  };

  const adjustSpeed = (delta: number) => {
    setSpeed((prev) => Math.max(10, Math.min(200, prev + delta)));
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
      {/* Control Bar */}
      <View style={styles.controlBar}>
        <TouchableOpacity style={styles.controlButton} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        <View style={styles.centerControls}>
          <TouchableOpacity style={styles.controlButton} onPress={() => adjustSpeed(-10)}>
            <Ionicons name="remove-circle-outline" size={24} color="#fff" />
            <Text style={styles.controlLabel}>Speed</Text>
          </TouchableOpacity>

          <Text style={styles.speedText}>{speed}</Text>

          <TouchableOpacity style={styles.controlButton} onPress={() => adjustSpeed(10)}>
            <Ionicons name="add-circle-outline" size={24} color="#fff" />
            <Text style={styles.controlLabel}>Speed</Text>
          </TouchableOpacity>

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
        </View>
      </View>

      {/* Script Content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isPlaying}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          if (!isPlaying) {
            setScrollPosition(e.nativeEvent.contentOffset.y);
          }
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.scriptContainer}>
          <Text style={[styles.scriptText, { fontSize }]}>{script.content}</Text>
        </View>
      </ScrollView>

      {/* Reading Guide Line */}
      <View style={styles.guideLine} />
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
  speedText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    minWidth: 40,
    textAlign: "center",
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
    paddingTop: 200,
    paddingBottom: Dimensions.get("window").height,
    paddingHorizontal: 40,
  },
  scriptContainer: {
    alignItems: "center",
  },
  scriptText: {
    color: "#fff",
    lineHeight: 1.8,
    textAlign: "center",
    fontWeight: "500",
  },
  guideLine: {
    position: "absolute",
    top: "30%",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#FF3B30",
    opacity: 0.5,
  },
});
