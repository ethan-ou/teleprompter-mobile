import { db } from "@/db";
import { scripts } from "@/db/schema";
import { Ionicons } from "@expo/vector-icons";
import { eq } from "drizzle-orm";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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

export default function EditScript() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id && id !== "new") {
      loadScript();
    } else {
      setLoading(false);
    }
  }, [id]);

  const loadScript = async () => {
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
  };

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

  const deleteScript = async () => {
    if (!id || id === "new") return;

    Alert.alert("Delete Script", "Are you sure you want to delete this script?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await db.delete(scripts).where(eq(scripts.id, Number(id)));
            router.back();
          } catch (error) {
            console.error("Failed to delete script:", error);
            Alert.alert("Error", "Failed to delete script");
          }
        },
      },
    ]);
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
      <View style={styles.header}>
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

      {id && id !== "new" && (
        <TouchableOpacity style={styles.deleteButton} onPress={deleteScript}>
          <Ionicons name="trash-outline" size={24} color="#FF3B30" />
          <Text style={styles.deleteText}>Delete Script</Text>
        </TouchableOpacity>
      )}
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
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerButton: {
    width: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  saveText: {
    fontSize: 17,
    color: "#007AFF",
    fontWeight: "600",
    textAlign: "right",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 20,
    padding: 0,
  },
  contentInput: {
    flex: 1,
    fontSize: 18,
    lineHeight: 28,
    padding: 0,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 32,
    borderRadius: 12,
    backgroundColor: "#FFF0F0",
    gap: 8,
  },
  deleteText: {
    fontSize: 17,
    color: "#FF3B30",
    fontWeight: "600",
  },
});
