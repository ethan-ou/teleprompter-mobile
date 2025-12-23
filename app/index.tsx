import { db } from "@/db";
import { scripts } from "@/db/schema";
import { Ionicons } from "@expo/vector-icons";
import { inArray } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function Index() {
  const router = useRouter();
  const { data: scriptList } = useLiveQuery(db.select().from(scripts));
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const handleLongPress = (id: number) => {
    setSelectionMode(true);
    setSelectedIds([id]);
  };

  const handlePress = (id: number) => {
    if (selectionMode) {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((selectedId) => selectedId !== id));
      } else {
        setSelectedIds([...selectedIds, id]);
      }
    } else {
      router.push(`/edit/${id}`);
    }
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;

    Alert.alert(
      "Delete Scripts",
      `Are you sure you want to delete ${selectedIds.length} script${
        selectedIds.length > 1 ? "s" : ""
      }?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await db.delete(scripts).where(inArray(scripts.id, selectedIds));
              setSelectionMode(false);
              setSelectedIds([]);
            } catch (error) {
              console.error("Failed to delete scripts:", error);
              Alert.alert("Error", "Failed to delete scripts");
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <TouchableOpacity onPress={cancelSelection}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{selectedIds.length} selected</Text>
            <TouchableOpacity
              style={[styles.deleteButton, selectedIds.length === 0 && styles.deleteButtonDisabled]}
              onPress={deleteSelected}
              disabled={selectedIds.length === 0}
            >
              <Ionicons
                name="trash-outline"
                size={24}
                color={selectedIds.length > 0 ? "#FF3B30" : "#ccc"}
              />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Scripts</Text>
            <TouchableOpacity style={styles.addButton} onPress={() => router.push("/edit")}>
              <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>
          </>
        )}
      </View>

      <FlatList
        data={scriptList || []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.scriptItem}
            onPress={() => handlePress(item.id)}
            onLongPress={() => handleLongPress(item.id)}
          >
            {selectionMode && (
              <View style={styles.checkboxContainer}>
                <Ionicons
                  name={selectedIds.includes(item.id) ? "checkbox" : "square-outline"}
                  size={28}
                  color={selectedIds.includes(item.id) ? "#007AFF" : "#ccc"}
                />
              </View>
            )}
            <View style={styles.scriptInfo}>
              <Text style={styles.scriptTitle}>{item.title}</Text>
              <Text style={styles.scriptPreview} numberOfLines={2}>
                {item.content}
              </Text>
            </View>
            {!selectionMode && (
              <TouchableOpacity
                style={styles.playButton}
                onPress={(e) => {
                  e.stopPropagation();
                  router.push(`/teleprompter/${item.id}`);
                }}
              >
                <Ionicons name="play-circle" size={32} color="#007AFF" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No scripts yet</Text>
            <Text style={styles.emptySubtext}>Tap the + button to create one</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingTop: 60,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
  },
  addButton: {
    backgroundColor: "#007AFF",
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    padding: 16,
  },
  scriptItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  scriptInfo: {
    flex: 1,
    marginRight: 12,
  },
  scriptTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  scriptPreview: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  playButton: {
    padding: 8,
  },
  checkboxContainer: {
    marginRight: 12,
  },
  cancelText: {
    fontSize: 17,
    color: "#007AFF",
    fontWeight: "600",
  },
  deleteButton: {
    padding: 8,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#999",
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 16,
    color: "#ccc",
    marginTop: 8,
  },
});
