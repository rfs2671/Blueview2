import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  Switch,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
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

interface TradeMapping {
  id: string;
  trade: string;
  legal_name: string;
}

export default function ReportSettingsScreen() {
  const router = useRouter();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Report Settings
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [triggerTime, setTriggerTime] = useState('17:00');
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [includeJobsiteLog, setIncludeJobsiteLog] = useState(true);
  const [includeSafetyOrientation, setIncludeSafetyOrientation] = useState(true);
  const [includeSafetyMeeting, setIncludeSafetyMeeting] = useState(true);
  
  // Trade Mappings
  const [tradeMappings, setTradeMappings] = useState<TradeMapping[]>([]);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [newTrade, setNewTrade] = useState('');
  const [newLegalName, setNewLegalName] = useState('');
  
  // NFC Tags
  const [nfcTags, setNfcTags] = useState<any[]>([]);
  const [showNfcModal, setShowNfcModal] = useState(false);
  const [newTagId, setNewTagId] = useState('');
  const [newTagLocation, setNewTagLocation] = useState('');
  
  // Project Info
  const [projectName, setProjectName] = useState('');
  
  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    if (user?.role !== 'admin') {
      Alert.alert('Access Denied', 'Only admins can access report settings');
      router.back();
      return;
    }
    fetchData();
  }, [projectId]);

  const fetchData = async () => {
    try {
      // Fetch project info
      const projectRes = await fetch(`${API_URL}/api/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (projectRes.ok) {
        const projectData = await projectRes.json();
        setProjectName(projectData.name || 'Unknown Project');
      }
      
      // Fetch report settings
      const settingsRes = await fetch(`${API_URL}/api/projects/${projectId}/report-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setEmailRecipients(settings.email_recipients || []);
        setTriggerTime(settings.report_trigger_time || '17:00');
        setAutoSendEnabled(settings.auto_send_enabled !== false);
        setIncludeJobsiteLog(settings.include_jobsite_log !== false);
        setIncludeSafetyOrientation(settings.include_safety_orientation !== false);
        setIncludeSafetyMeeting(settings.include_safety_meeting !== false);
      }
      
      // Fetch trade mappings
      const mappingsRes = await fetch(`${API_URL}/api/trade-mappings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (mappingsRes.ok) {
        const mappings = await mappingsRes.json();
        setTradeMappings(Array.isArray(mappings) ? mappings : []);
      }
      
      // Fetch NFC tags
      const tagsRes = await fetch(`${API_URL}/api/nfc-tags`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (tagsRes.ok) {
        const tags = await tagsRes.json();
        setNfcTags(Array.isArray(tags) ? tags.filter(t => t.project_id === projectId) : []);
      }
      
    } catch (error) {
      console.log('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/projects/${projectId}/report-settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: projectId,
          email_recipients: emailRecipients,
          report_trigger_time: triggerTime,
          auto_send_enabled: autoSendEnabled,
          include_jobsite_log: includeJobsiteLog,
          include_safety_orientation: includeSafetyOrientation,
          include_safety_meeting: includeSafetyMeeting,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Success', 'Report settings saved');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const addEmailRecipient = () => {
    if (!newEmail.trim() || !newEmail.includes('@')) {
      Alert.alert('Invalid', 'Please enter a valid email address');
      return;
    }
    if (emailRecipients.includes(newEmail.trim())) {
      Alert.alert('Duplicate', 'This email is already in the list');
      return;
    }
    setEmailRecipients([...emailRecipients, newEmail.trim()]);
    setNewEmail('');
  };

  const removeEmailRecipient = (email: string) => {
    setEmailRecipients(emailRecipients.filter(e => e !== email));
  };

  const addTradeMapping = async () => {
    if (!newTrade.trim() || !newLegalName.trim()) {
      Alert.alert('Required', 'Please fill in both fields');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/trade-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trade: newTrade.trim(),
          legal_name: newLegalName.trim(),
        }),
      });

      if (response.ok) {
        setNewTrade('');
        setNewLegalName('');
        setShowMappingModal(false);
        fetchData();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to add mapping');
    }
  };

  const deleteTradeMapping = async (mappingId: string) => {
    try {
      await fetch(`${API_URL}/api/trade-mappings/${mappingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchData();
    } catch (error) {
      Alert.alert('Error', 'Failed to delete mapping');
    }
  };

  const addNfcTag = async () => {
    if (!newTagId.trim()) {
      Alert.alert('Required', 'Please enter the NFC tag ID');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/nfc-tags`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: projectId,
          tag_id: newTagId.trim(),
          location_description: newTagLocation.trim(),
        }),
      });

      if (response.ok) {
        setNewTagId('');
        setNewTagLocation('');
        setShowNfcModal(false);
        fetchData();
        Alert.alert('Success', 'NFC tag registered');
      } else {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to register tag');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleGenerateReport = async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    
    Alert.alert(
      'Generate Report',
      'Generate and send today\'s daily report now?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate & Send',
          onPress: async () => {
            setSaving(true);
            try {
              const response = await fetch(`${API_URL}/api/projects/${projectId}/generate-daily-report`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              
              const result = await response.json();
              
              if (response.ok) {
                Alert.alert(
                  'Report Generated',
                  `Workers: ${result.workers_count}\nReports: ${result.reports_generated.join(', ')}\nEmail Sent: ${result.email_sent ? 'Yes' : 'No'}`
                );
              } else {
                throw new Error(result.detail || 'Failed to generate report');
              }
            } catch (error: any) {
              Alert.alert('Error', error.message);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Report Settings</Text>
          <Text style={styles.headerSubtitle}>{projectName}</Text>
        </View>
        <TouchableOpacity 
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          onPress={handleSaveSettings}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.text} />
          ) : (
            <Ionicons name="checkmark" size={24} color={COLORS.text} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Manual Generate */}
        <TouchableOpacity style={styles.generateButton} onPress={handleGenerateReport}>
          <Ionicons name="paper-plane" size={24} color={COLORS.text} />
          <Text style={styles.generateButtonText}>Generate & Send Report Now</Text>
        </TouchableOpacity>

        {/* Email Recipients Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="mail" size={20} color={COLORS.secondary} />
            <Text style={styles.sectionTitle}>Email Recipients</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Daily reports will be sent to these email addresses
          </Text>
          
          <View style={styles.addEmailRow}>
            <TextInput
              style={styles.emailInput}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder="Add email address"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.addEmailButton} onPress={addEmailRecipient}>
              <Ionicons name="add" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          
          {emailRecipients.map((email, index) => (
            <View key={index} style={styles.emailChip}>
              <Text style={styles.emailChipText}>{email}</Text>
              <TouchableOpacity onPress={() => removeEmailRecipient(email)}>
                <Ionicons name="close-circle" size={20} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Schedule Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="time" size={20} color={COLORS.warning} />
            <Text style={styles.sectionTitle}>Report Schedule</Text>
          </View>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Trigger Time</Text>
            <TextInput
              style={styles.timeInput}
              value={triggerTime}
              onChangeText={setTriggerTime}
              placeholder="17:00"
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Auto-Send Enabled</Text>
            <Switch
              value={autoSendEnabled}
              onValueChange={setAutoSendEnabled}
              trackColor={{ false: COLORS.border, true: COLORS.success }}
              thumbColor={autoSendEnabled ? COLORS.text : COLORS.textSecondary}
            />
          </View>
        </View>

        {/* Report Types Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text" size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Include in Report</Text>
          </View>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>NYC DOB Jobsite Log</Text>
            <Switch
              value={includeJobsiteLog}
              onValueChange={setIncludeJobsiteLog}
              trackColor={{ false: COLORS.border, true: COLORS.success }}
            />
          </View>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Safety Orientation Form</Text>
            <Switch
              value={includeSafetyOrientation}
              onValueChange={setIncludeSafetyOrientation}
              trackColor={{ false: COLORS.border, true: COLORS.success }}
            />
          </View>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Pre-Shift Safety Meeting</Text>
            <Switch
              value={includeSafetyMeeting}
              onValueChange={setIncludeSafetyMeeting}
              trackColor={{ false: COLORS.border, true: COLORS.success }}
            />
          </View>
        </View>

        {/* Trade Mappings Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="swap-horizontal" size={20} color={COLORS.success} />
            <Text style={styles.sectionTitle}>Trade → Legal Name Mapping</Text>
            <TouchableOpacity 
              style={styles.addMappingButton}
              onPress={() => setShowMappingModal(true)}
            >
              <Ionicons name="add" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionDescription}>
            Map worker trades to legal subcontractor names for reports
          </Text>
          
          {tradeMappings.length === 0 ? (
            <Text style={styles.emptyText}>No mappings configured</Text>
          ) : (
            tradeMappings.map((mapping) => (
              <View key={mapping.id} style={styles.mappingRow}>
                <View style={styles.mappingInfo}>
                  <Text style={styles.mappingTrade}>{mapping.trade}</Text>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.mappingLegal}>{mapping.legal_name}</Text>
                </View>
                <TouchableOpacity onPress={() => deleteTradeMapping(mapping.id)}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* NFC Tags Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="wifi" size={20} color={COLORS.secondary} />
            <Text style={styles.sectionTitle}>NFC Check-In Tags</Text>
            <TouchableOpacity 
              style={styles.addMappingButton}
              onPress={() => setShowNfcModal(true)}
            >
              <Ionicons name="add" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionDescription}>
            Register NFC tags for worker check-in at this site
          </Text>
          
          {nfcTags.length === 0 ? (
            <Text style={styles.emptyText}>No NFC tags registered</Text>
          ) : (
            nfcTags.map((tag) => (
              <View key={tag.id} style={styles.nfcTagRow}>
                <Ionicons name="radio-button-on" size={16} color={COLORS.success} />
                <View style={styles.nfcTagInfo}>
                  <Text style={styles.nfcTagId}>Tag: {tag.tag_id}</Text>
                  {tag.location_description && (
                    <Text style={styles.nfcTagLocation}>{tag.location_description}</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Trade Mapping Modal */}
      <Modal
        visible={showMappingModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowMappingModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Trade Mapping</Text>
              <TouchableOpacity onPress={() => setShowMappingModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Trade Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newTrade}
                  onChangeText={setNewTrade}
                  placeholder="e.g., Framing"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Legal Subcontractor Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newLegalName}
                  onChangeText={setNewLegalName}
                  placeholder="e.g., ODD LLC"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
              
              <TouchableOpacity style={styles.modalButton} onPress={addTradeMapping}>
                <Text style={styles.modalButtonText}>Add Mapping</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* NFC Tag Modal */}
      <Modal
        visible={showNfcModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowNfcModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Register NFC Tag</Text>
              <TouchableOpacity onPress={() => setShowNfcModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>NFC Tag ID *</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newTagId}
                  onChangeText={setNewTagId}
                  placeholder="Unique tag identifier"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Location Description</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newTagLocation}
                  onChangeText={setNewTagLocation}
                  placeholder="e.g., Main Entrance"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
              
              <TouchableOpacity style={styles.modalButton} onPress={addNfcTag}>
                <Text style={styles.modalButtonText}>Register Tag</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    flex: 1,
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
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 20,
    gap: 10,
  },
  generateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  sectionDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  addEmailRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  emailInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addEmailButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  emailChipText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingLabel: {
    fontSize: 14,
    color: COLORS.text,
  },
  timeInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.text,
    width: 80,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addMappingButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  mappingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  mappingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  mappingTrade: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  mappingLegal: {
    fontSize: 14,
    color: COLORS.secondary,
  },
  nfcTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  nfcTagInfo: {
    flex: 1,
  },
  nfcTagId: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  nfcTagLocation: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalBody: {
    padding: 16,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
