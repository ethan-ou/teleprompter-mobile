import { db } from "@/db";
import { scripts } from "@/db/schema";
import { colors } from "@/lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const WORDS_PER_MINUTE = 130;

export default function EditScript() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const isExisting = !!id && id !== "new";
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  const loadScript = useCallback(async () => {
    try {
      const result = await db
        .select()
        .from(scripts)
        .where(eq(scripts.id, Number(id)));

      if (result.length > 0) {
        setTitle(result[0].title);
        setContent(result[0].content);
      }
    } catch (error) {
      console.error("Failed to load script:", error);
      Alert.alert("Error", "Failed to load script");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (isExisting) {
      loadScript();
    } else {
      setLoading(false);
    }
  }, [isExisting, loadScript]);

  const stats = useMemo(() => {
    const trimmed = content.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const minutes = words / WORDS_PER_MINUTE;
    const time = words === 0 ? "" : minutes < 1 ? "<1 min" : `${Math.round(minutes)} min`;
    return { words, time };
  }, [content]);

  // Persist and return the script id (creating it if new). Returns null on failure.
  const persist = useCallback(async (): Promise<number | null> => {
    if (!title.trim()) {
      Alert.alert("Title required", "Please enter a title for your script.");
      return null;
    }
    try {
      if (isExisting) {
        await db
          .update(scripts)
          .set({ title: title.trim(), content: content.trim(), updatedAt: new Date() })
          .where(eq(scripts.id, Number(id)));
        return Number(id);
      }
      const inserted = await db
        .insert(scripts)
        .values({
          title: title.trim(),
          content: content.trim(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: scripts.id });
      return inserted[0]?.id ?? null;
    } catch (error) {
      console.error("Failed to save script:", error);
      Alert.alert("Error", "Failed to save script");
      return null;
    }
  }, [title, content, isExisting, id]);

  const handleSave = async () => {
    const savedId = await persist();
    if (savedId !== null) router.back();
  };

  const handlePresent = async () => {
    const savedId = await persist();
    if (savedId !== null) router.replace(`/teleprompter/${savedId}`);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerSide} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.accent} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isExisting ? "Edit" : "New Script"}</Text>
        <TouchableOpacity style={styles.headerSide} onPress={handleSave} hitSlop={8}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <TextInput
          style={styles.titleInput}
          placeholder="Script title"
          value={title}
          onChangeText={setTitle}
          placeholderTextColor={colors.textFaint}
        />

        <View style={styles.statsRow}>
          <Text style={styles.statsText}>
            {stats.words} words{stats.time ? ` · ${stats.time}` : ""}
          </Text>
        </View>

        <TextInput
          style={styles.contentInput}
          placeholder="Write or paste your script here…"
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          placeholderTextColor={colors.textFaint}
        />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={styles.presentButton} onPress={handlePresent} activeOpacity={0.85}>
          <Ionicons name="play" size={20} color="#fff" />
          <Text style={styles.presentText}>Save & Present</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSide: {
    minWidth: 64,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: colors.text,
  },
  saveText: {
    fontSize: 17,
    color: colors.accent,
    fontFamily: "Inter_600SemiBold",
    textAlign: "right",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleInput: {
    fontSize: 24,
    fontFamily: "Inter_600SemiBold",
    color: colors.text,
    padding: 0,
  },
  statsRow: {
    marginTop: 8,
    marginBottom: 16,
  },
  statsText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: colors.textMuted,
  },
  contentInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_400Regular",
    lineHeight: 28,
    color: colors.text,
    padding: 0,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  presentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 15,
  },
  presentText: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
});
