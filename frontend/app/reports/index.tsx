import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import Constants from 'expo-constants';

const COLORS = {
  background: '#0A1929',
  surface: '#132F4C',
  surfaceLight: '#1E3A5F',
  primary: '#FF6B00',
  secondary: '#00D4FF',
  success: '#4CAF50',
  warning: '#FFB800',
  danger: '#FF4444',
  text: '#FFFFFF',
  textSecondary: '#B0BEC5',
  border: '#2D4A6F',
};

interface ReportData {
  pdf_base64: string;
  filename: string;
  message: string;
}

export default function ReportsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [sampleReportReady, setSampleReportReady] = useState(false);
  const [setupStatus, setSetupStatus] = useState<any>(null);
  
const API_URL = 'https://blueview2-production.up.railway.app';

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/setup/status`);
      const data = await response.json();
      setSetupStatus(data);
    } catch (error) {
      console.log('Error checking setup status:', error);
    }
  };

  const handleGenerateSampleReport = async () => {
    setLoading(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      const response = await fetch(`${API_URL}/api/demo/sample-report`);
      
      if (!response.ok) {
        throw new Error('Failed to generate report');
      }
      
      const data: ReportData = await response.json();
      
      if (Platform.OS === 'web') {
        // Web: Open PDF in new tab
        const byteCharacters = atob(data.pdf_base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } else {
        // Mobile: Save and share
        const fileUri = `${FileSystem.documentDirectory}${data.filename}`;
        await FileSystem.writeAsStringAsync(fileUri, data.pdf_base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Daily Field Report',
          });
        } else {
          Alert.alert('Success', `Report saved to: ${fileUri}`);
        }
      }
      
      setSampleReportReady(true);
      
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSampleData = async () => {
    if (!token) {
      Alert.alert('Login Required', 'Please login as admin to create sample data');
      return;
    }

    setLoading(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      const response = await fetch(`${API_URL}/api/demo/create-sample-data`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create sample data');
      }
      
      const data = await response.json();
      Alert.alert('Success', `Sample data created:\n- Project: Downtown Tower\n- Workers: ${data.workers_created}\n- Daily Log: ${data.daily_log_created ? 'Created' : 'Exists'}`);
      checkSetupStatus();
      
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create sample data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Reports</Text>
          <Text style={styles.headerSubtitle}>Daily Field Reports</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* System Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Ionicons name="server" size={24} color={COLORS.secondary} />
            <Text style={styles.statusTitle}>System Status</Text>
          </View>
          
          {setupStatus && (
            <View style={styles.statusGrid}>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>Database</Text>
                <View style={[styles.statusBadge, { backgroundColor: COLORS.success + '20' }]}>
                  <Text style={[styles.statusValue, { color: COLORS.success }]}>MongoDB Atlas</Text>
                </View>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>Admin</Text>
                <View style={[styles.statusBadge, { backgroundColor: setupStatus.admin_exists ? COLORS.success + '20' : COLORS.warning + '20' }]}>
                  <Text style={[styles.statusValue, { color: setupStatus.admin_exists ? COLORS.success : COLORS.warning }]}>
                    {setupStatus.admin_exists ? 'Active' : 'Not Created'}
                  </Text>
                </View>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>Projects</Text>
                <Text style={styles.statusNumber}>{setupStatus.project_count || 0}</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>Workers</Text>
                <Text style={styles.statusNumber}>{setupStatus.worker_count || 0}</Text>
              </View>
            </View>
          )}
          
          {setupStatus?.integrations && (
            <View style={styles.integrationsRow}>
              <Text style={styles.integrationsLabel}>Integrations:</Text>
              {setupStatus.integrations.google_oauth && (
                <View style={styles.integrationBadge}>
                  <Ionicons name="logo-google" size={12} color={COLORS.text} />
                  <Text style={styles.integrationText}>Google</Text>
                </View>
              )}
              {setupStatus.integrations.openweather && (
                <View style={styles.integrationBadge}>
                  <Ionicons name="cloud" size={12} color={COLORS.text} />
                  <Text style={styles.integrationText}>Weather</Text>
                </View>
              )}
              {setupStatus.integrations.resend_email && (
                <View style={styles.integrationBadge}>
                  <Ionicons name="mail" size={12} color={COLORS.text} />
                  <Text style={styles.integrationText}>Email</Text>
                </View>
              )}
              {setupStatus.integrations.dropbox && (
                <View style={styles.integrationBadge}>
                  <Ionicons name="cloud-upload" size={12} color={COLORS.text} />
                  <Text style={styles.integrationText}>Dropbox</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Sample Report Card */}
        <View style={styles.reportCard}>
          <View style={styles.reportIcon}>
            <Ionicons name="document-text" size={40} color={COLORS.primary} />
          </View>
          <Text style={styles.reportTitle}>Sample Daily Report</Text>
          <Text style={styles.reportDescription}>
            Generate a complete, professional "Raken-style" PDF report with sample data including:
          </Text>
          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={styles.featureText}>Project details & weather</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={styles.featureText}>Worker sign-in ledger (8 workers)</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={styles.featureText}>Subcontractor work summaries</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={styles.featureText}>Site inspection results</Text>
            </View>
          </View>
          
          <TouchableOpacity
            style={[styles.generateButton, loading && styles.buttonDisabled]}
            onPress={handleGenerateSampleReport}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <>
                <Ionicons name="download" size={20} color={COLORS.text} />
                <Text style={styles.generateButtonText}>
                  {Platform.OS === 'web' ? 'View Sample Report' : 'Download Sample Report'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {sampleReportReady && (
            <View style={styles.successMessage}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              <Text style={styles.successText}>Report generated successfully!</Text>
            </View>
          )}
        </View>

        {/* Create Sample Data Card */}
        <View style={styles.actionCard}>
          <View style={styles.actionHeader}>
            <Ionicons name="flask" size={24} color={COLORS.warning} />
            <Text style={styles.actionTitle}>Create Sample Data</Text>
          </View>
          <Text style={styles.actionDescription}>
            Create sample project, workers, and daily log entries for testing the complete flow.
          </Text>
          <TouchableOpacity
            style={[styles.secondaryButton, loading && styles.buttonDisabled]}
            onPress={handleCreateSampleData}
            disabled={loading}
          >
            <Ionicons name="add-circle" size={18} color={COLORS.text} />
            <Text style={styles.secondaryButtonText}>Create Sample Data</Text>
          </TouchableOpacity>
        </View>

        {/* Admin Credentials Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="key" size={20} color={COLORS.secondary} />
            <Text style={styles.infoTitle}>Admin Credentials</Text>
          </View>
          <View style={styles.credentialBox}>
            <Text style={styles.credentialLabel}>Email:</Text>
            <Text style={styles.credentialValue}>admin@blueview.com</Text>
          </View>
          <View style={styles.credentialBox}>
            <Text style={styles.credentialLabel}>Password:</Text>
            <Text style={styles.credentialValue}>BlueviewAdmin123</Text>
          </View>
          <Text style={styles.credentialNote}>
            Use these credentials to login as admin and access all features.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  statusCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statusItem: {
    width: '47%',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 12,
  },
  statusLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  integrationsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 16,
    gap: 8,
  },
  integrationsLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  integrationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  integrationText: {
    fontSize: 11,
    color: COLORS.text,
  },
  reportCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  reportIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  reportTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  reportDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  featureList: {
    width: '100%',
    marginBottom: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  featureText: {
    fontSize: 14,
    color: COLORS.text,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  generateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  successMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  successText: {
    fontSize: 14,
    color: COLORS.success,
  },
  actionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  actionDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  infoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  credentialBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  credentialLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    width: 70,
  },
  credentialValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.secondary,
    flex: 1,
  },
  credentialNote: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
