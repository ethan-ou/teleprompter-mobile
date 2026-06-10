import { db } from "@/db";
import { scripts } from "@/db/schema";
import { colors } from "@/lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { inArray } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Average reading pace used for the duration estimate.
const WORDS_PER_MINUTE = 130;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function readingTime(words: number): string {
  if (words === 0) return "Empty";
  const minutes = words / WORDS_PER_MINUTE;
  if (minutes < 1) return `${words} words · <1 min`;
  return `${words} words · ${Math.round(minutes)} min`;
}

export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: scriptList } = useLiveQuery(db.select().from(scripts));
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);

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
      // Tapping a script presents it — the obvious primary action.
      router.push(`/teleprompter/${id}`);
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
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        {selectionMode ? (
          <>
            <TouchableOpacity onPress={cancelSelection} hitSlop={8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{selectedIds.length} selected</Text>
            <TouchableOpacity
              style={[styles.iconButton, selectedIds.length === 0 && styles.disabled]}
              onPress={deleteSelected}
              disabled={selectedIds.length === 0}
              hitSlop={8}
            >
              <Ionicons
                name="trash-outline"
                size={24}
                color={selectedIds.length > 0 ? colors.danger : colors.textFaint}
              />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Scripts</Text>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setMenuVisible(!menuVisible)}
              hitSlop={8}
            >
              <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Dropdown Menu */}
      {menuVisible && !selectionMode && (
        <>
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push("/edit");
              }}
            >
              <Ionicons name="add-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>New Script</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setSelectionMode(true);
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>Select & Delete</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <FlatList
        data={scriptList || []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const selected = selectedIds.includes(item.id);
          return (
            <TouchableOpacity
              style={[styles.scriptItem, selected && styles.scriptItemSelected]}
              onPress={() => handlePress(item.id)}
              onLongPress={() => handleLongPress(item.id)}
              activeOpacity={0.7}
            >
              {selectionMode && (
                <View style={styles.checkboxContainer}>
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={26}
                    color={selected ? colors.accent : colors.textFaint}
                  />
                </View>
              )}
              <View style={styles.scriptInfo}>
                <Text style={styles.scriptTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.scriptMeta}>{readingTime(wordCount(item.content))}</Text>
                <Text style={styles.scriptPreview} numberOfLines={2}>
                  {item.content}
                </Text>
              </View>
              {!selectionMode && (
                <View style={styles.scriptActions}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push(`/edit/${item.id}`);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="create-outline" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push(`/teleprompter/${item.id}`);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="play-circle" size={36} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color={colors.textFaint} />
            <Text style={styles.emptyText}>No scripts yet</Text>
            <Text style={styles.emptySubtext}>Tap + to create your first script</Text>
          </View>
        }
      />

      {/* Floating Action Button */}
      {!selectionMode && (
        <TouchableOpacity style={styles.fab} onPress={() => router.push("/edit")} activeOpacity={0.8}>
          <Ionicons name="add" size={32} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    color: colors.text,
  },
  iconButton: {
    padding: 8,
  },
  disabled: {
    opacity: 0.4,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  menuContainer: {
    position: "absolute",
    top: 96,
    right: 16,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 190,
    zIndex: 1000,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemText: {
    fontSize: 16,
    color: colors.text,
    fontFamily: "Inter_500Medium",
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  fab: {
    position: "absolute",
    bottom: 32,
    right: 24,
    backgroundColor: colors.accent,
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
  },
  scriptItem: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  scriptItemSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceElevated,
  },
  scriptInfo: {
    flex: 1,
    marginRight: 12,
  },
  scriptTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: colors.text,
    marginBottom: 4,
  },
  scriptMeta: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: colors.accent,
    marginBottom: 6,
  },
  scriptPreview: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: colors.textMuted,
    lineHeight: 20,
  },
  scriptActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionButton: {
    padding: 4,
  },
  checkboxContainer: {
    marginRight: 14,
  },
  cancelText: {
    fontSize: 17,
    color: colors.accent,
    fontFamily: "Inter_600SemiBold",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    color: colors.textMuted,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: colors.textFaint,
    marginTop: 8,
  },
});
