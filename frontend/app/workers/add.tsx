import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import { api } from '../../src/utils/api';

const TRADES = [
  'Electrician',
  'Plumber',
  'Carpenter',
  'Mason',
  'Painter',
  'Welder',
  'HVAC Technician',
  'General Laborer',
  'Equipment Operator',
  'Ironworker',
  'Roofing',
  'Drywall',
  'Concrete',
  'Other',
];

export default function AddWorkerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    trade: '',
    company: '',
    certifications: [] as string[],
  });
  const [showTrades, setShowTrades] = useState(false);
  const [newCert, setNewCert] = useState('');

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Required', 'Please enter worker name');
      return;
    }
    if (!formData.trade) {
      Alert.alert('Required', 'Please select a trade');
      return;
    }
    if (!formData.company.trim()) {
      Alert.alert('Required', 'Please enter company name');
      return;
    }

    setLoading(true);
    try {
      await api.createWorker(formData);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Success', 'Worker added successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to add worker');
    } finally {
      setLoading(false);
    }
  };

  const addCertification = () => {
    if (newCert.trim() && !formData.certifications.includes(newCert.trim())) {
      setFormData({
        ...formData,
        certifications: [...formData.certifications, newCert.trim()],
      });
      setNewCert('');
    }
  };

  const removeCertification = (cert: string) => {
    setFormData({
      ...formData,
      certifications: formData.certifications.filter((c) => c !== cert),
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Worker</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="John Smith"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {/* Trade */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Trade *</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => setShowTrades(!showTrades)}
            >
              <Text
                style={[
                  styles.selectButtonText,
                  !formData.trade && styles.placeholder,
                ]}
              >
                {formData.trade || 'Select Trade'}
              </Text>
              <Ionicons
                name={showTrades ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>
            {showTrades && (
              <View style={styles.optionsContainer}>
                {TRADES.map((trade) => (
                  <TouchableOpacity
                    key={trade}
                    style={[
                      styles.option,
                      formData.trade === trade && styles.optionSelected,
                    ]}
                    onPress={() => {
                      setFormData({ ...formData, trade });
                      setShowTrades(false);
                      if (Platform.OS !== 'web') {
                        Haptics.selectionAsync();
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        formData.trade === trade && styles.optionTextSelected,
                      ]}
                    >
                      {trade}
                    </Text>
                    {formData.trade === trade && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={COLORS.primary}
                      />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Company */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Company *</Text>
            <TextInput
              style={styles.input}
              value={formData.company}
              onChangeText={(text) => setFormData({ ...formData, company: text })}
              placeholder="ABC Construction Co."
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {/* Certifications */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Certifications</Text>
            <View style={styles.certInputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={newCert}
                onChangeText={setNewCert}
                placeholder="OSHA 30, First Aid, etc."
                placeholderTextColor={COLORS.textMuted}
                onSubmitEditing={addCertification}
              />
              <TouchableOpacity
                style={styles.addCertButton}
                onPress={addCertification}
              >
                <Ionicons name="add" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.certList}>
              {formData.certifications.map((cert) => (
                <View key={cert} style={styles.certBadge}>
                  <Text style={styles.certText}>{cert}</Text>
                  <TouchableOpacity
                    onPress={() => removeCertification(cert)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={16} color={COLORS.text} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>

          {/* Note about signature */}
          <View style={styles.signatureNote}>
            <Ionicons name="information-circle" size={20} color={COLORS.secondary} />
            <Text style={styles.signatureNoteText}>
              Digital signature can be added after creating the worker profile
            </Text>
          </View>
        </ScrollView>

        {/* Submit Button */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <>
                <Ionicons name="person-add" size={20} color={COLORS.text} />
                <Text style={styles.submitButtonText}>Add Worker</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectButtonText: {
    fontSize: 16,
    color: COLORS.text,
  },
  placeholder: {
    color: COLORS.textMuted,
  },
  optionsContainer: {
    marginTop: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 250,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  optionSelected: {
    backgroundColor: COLORS.surfaceLight,
  },
  optionText: {
    fontSize: 15,
    color: COLORS.text,
  },
  optionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  certInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addCertButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  certList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  certBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  certText: {
    fontSize: 14,
    color: COLORS.text,
  },
  signatureNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    gap: 12,
  },
  signatureNoteText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  bottomBar: {
    padding: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
