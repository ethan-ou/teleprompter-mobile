import { db } from "@/db";
import { scripts } from "@/db/schema";
import { Ionicons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

export default function EditScript() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
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
    if (id && id !== "new") {
      loadScript();
    } else {
      setLoading(false);
    }
  }, [id, loadScript]);

  const saveScript = async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Please enter a title");
      return;
    }

    try {
      if (id && id !== "new") {
        // Update existing script
        await db
          .update(scripts)
          .set({
            title: title.trim(),
            content: content.trim(),
            updatedAt: new Date(),
          })
          .where(eq(scripts.id, Number(id)));
      } else {
        // Create new script
        await db.insert(scripts).values({
          title: title.trim(),
          content: content.trim(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      router.back();
    } catch (error) {
      console.error("Failed to save script:", error);
      Alert.alert("Error", "Failed to save script");
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{id && id !== "new" ? "Edit Script" : "New Script"}</Text>
        <TouchableOpacity style={styles.headerButton} onPress={saveScript}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <TextInput
          style={styles.titleInput}
          placeholder="Script Title"
          value={title}
          onChangeText={setTitle}
          placeholderTextColor="#999"
        />

        <TextInput
          style={styles.contentInput}
          placeholder="Enter your script content here..."
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          placeholderTextColor="#999"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerButton: {
    width: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  saveText: {
    fontSize: 17,
    color: "#007AFF",
    fontFamily: "Inter_600SemiBold",
    textAlign: "right",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleInput: {
    fontSize: 24,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 20,
    padding: 0,
  },
  contentInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_400Regular",
    lineHeight: 28,
    padding: 0,
  },
});
