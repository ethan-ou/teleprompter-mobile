import { scoreAll } from "@/lib/benchmark/scorer";
import { SAMPLE_CASES } from "@/lib/benchmark/sample";
import type { BenchmarkResult } from "@/lib/benchmark/types";
import { colors } from "@/lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/*
  Hidden dev screen: ASR far-field benchmark (docs/voice-asr-plan.md §3).
  Reach it manually by navigating to /benchmark. Runs the scorer over built-in
  synthetic cases to prove the harness; swap SAMPLE_CASES for real logged engine
  output from the far-field recording matrix to compare candidate models.
*/

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, good === true && styles.good, good === false && styles.bad]}>
        {value}
      </Text>
    </View>
  );
}

function ResultCard({ result }: { result: BenchmarkResult }) {
  const t = result.trackingError;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{result.name}</Text>
      <View style={styles.metricRow}>
        <Metric
          label="First partial"
          value={result.firstPartialLatencyMs === null ? "—" : `${result.firstPartialLatencyMs} ms`}
          good={result.firstPartialLatencyMs !== null && result.firstPartialLatencyMs < 400}
        />
        <Metric
          label="Word latency"
          value={result.meanWordLatencyMs === null ? "—" : `${result.meanWordLatencyMs} ms`}
          good={result.meanWordLatencyMs !== null && result.meanWordLatencyMs < 500}
        />
        <Metric label="WER" value={`${Math.round(result.wer * 100)}%`} good={result.wer < 0.15} />
        <Metric label="RTFx" value={result.rtfx === null ? "—" : `${result.rtfx}×`} />
      </View>
      <View style={styles.sectionDivider} />
      <Text style={styles.sectionLabel}>Cursor tracking (the metric that matters)</Text>
      <View style={styles.metricRow}>
        <Metric label="Mean lag" value={`${t.meanLagWords} w`} good={t.meanLagWords < 2} />
        <Metric label="Max lag" value={`${t.maxLagWords} w`} good={t.maxLagWords < 5} />
        <Metric label="Misjumps" value={`${t.misjumps}`} good={t.misjumps === 0} />
        <Metric
          label="Longest stall"
          value={`${t.longestStallMs} ms`}
          good={t.longestStallMs < 1000}
        />
      </View>
    </View>
  );
}

export default function Benchmark() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const results = useMemo(() => scoreAll(SAMPLE_CASES), []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.accent} />
        </TouchableOpacity>
        <Text style={styles.title}>ASR Benchmark</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Far-field cursor-tracking benchmark. Showing built-in synthetic cases — replace{" "}
          <Text style={styles.code}>SAMPLE_CASES</Text> with real logged engine output from the
          recording matrix to compare candidate models. The scorer replays each engine through the
          production matcher, so tracking error is judged exactly as it runs live.
        </Text>
        {results.map((result) => (
          <ResultCard key={result.name} result={result} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.text },
  content: { padding: 16, paddingBottom: 48 },
  intro: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  code: { fontFamily: "Inter_600SemiBold", color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 14,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  metric: { minWidth: 70 },
  metricLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
  },
  metricValue: { color: colors.text, fontSize: 18, fontFamily: "Inter_700Bold" },
  good: { color: "#30D158" },
  bad: { color: colors.danger },
  sectionDivider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
  },
});
