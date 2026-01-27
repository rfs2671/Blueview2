import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import { COLORS } from '../src/constants/colors';
import { api } from '../src/utils/api';
import SignaturePad from '../src/components/SignaturePad';

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
  'Other',
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { user, token, refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showTrades, setShowTrades] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    trade: '',
    company: '',
    osha_number: '',
    signature: '',
  });

  const handleNext = () => {
    if (step === 1) {
      if (!formData.name.trim() || !formData.trade || !formData.company.trim()) {
        Alert.alert('Required', 'Please fill in all required fields');
        return;
      }
      setStep(2);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (!formData.signature) {
      Alert.alert('Required', 'Please add your digital signature');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${api.API_URL || ''}/api/workers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to create passport');
      }

      await refreshUser();
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      Alert.alert('Success', 'Worker Passport created!', [
        { text: 'Continue', onPress: () => router.replace('/') },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create passport');
    } finally {
      setLoading(false);
    }
  };

  const handleSignatureSave = (signature: string) => {
    setFormData({ ...formData, signature });
    setShowSignaturePad(false);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          {step > 1 && (
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
          )}
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Worker Passport</Text>
            <Text style={styles.headerSubtitle}>Step {step} of 2</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${(step / 2) * 100}%` }]} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && (
            <>
              <Text style={styles.stepTitle}>Basic Information</Text>
              <Text style={styles.stepSubtitle}>
                Enter your details to create your digital passport
              </Text>

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
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Company *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.company}
                  onChangeText={(text) => setFormData({ ...formData, company: text })}
                  placeholder="ABC Construction"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>OSHA Number (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.osha_number}
                  onChangeText={(text) => setFormData({ ...formData, osha_number: text })}
                  placeholder="e.g., 12345678"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.stepTitle}>Digital Signature</Text>
              <Text style={styles.stepSubtitle}>
                Your signature will be used to sign daily logs and compliance documents
              </Text>

              <View style={styles.signatureSection}>
                {formData.signature ? (
                  <View style={styles.signaturePreview}>
                    <View style={styles.signatureImage}>
                      <Text style={styles.signaturePreviewText}>Signature Captured</Text>
                      <Ionicons name="checkmark-circle" size={32} color={COLORS.success} />
                    </View>
                    <TouchableOpacity
                      style={styles.updateSignatureButton}
                      onPress={() => setShowSignaturePad(true)}
                    >
                      <Text style={styles.updateSignatureText}>Update Signature</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addSignatureButton}
                    onPress={() => setShowSignaturePad(true)}
                  >
                    <Ionicons name="create" size={32} color={COLORS.primary} />
                    <Text style={styles.addSignatureText}>Tap to Sign</Text>
                    <Text style={styles.addSignatureHint}>Use your finger to draw your signature</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.infoBox}>
                <Ionicons name="shield-checkmark" size={24} color={COLORS.success} />
                <View style={styles.infoBoxContent}>
                  <Text style={styles.infoBoxTitle}>Your Passport is Secure</Text>
                  <Text style={styles.infoBoxText}>
                    Your signature is encrypted and used only for compliance documentation.
                  </Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>

        {/* Bottom Actions */}
        <View style={styles.bottomBar}>
          {step === 1 ? (
            <TouchableOpacity
              style={styles.nextButton}
              onPress={handleNext}
            >
              <Text style={styles.nextButtonText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color={COLORS.text} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.submitButton,
                (!formData.signature || loading) && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!formData.signature || loading}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.text} />
                  <Text style={styles.submitButtonText}>Create Passport</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Signature Pad Modal */}
      {showSignaturePad && (
        <SignaturePad
          onSave={handleSignatureSave}
          onCancel={() => setShowSignaturePad(false)}
        />
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  progressContainer: {
    height: 4,
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    borderRadius: 2,
  },
  progressBar: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginBottom: 24,
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
    maxHeight: 200,
  },
  option: {
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
  signatureSection: {
    marginTop: 20,
  },
  addSignatureButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
  },
  addSignatureText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 12,
  },
  addSignatureHint: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  signaturePreview: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  signatureImage: {
    alignItems: 'center',
  },
  signaturePreviewText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  updateSignatureButton: {
    marginTop: 16,
  },
  updateSignatureText: {
    fontSize: 14,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    gap: 12,
  },
  infoBoxContent: {
    flex: 1,
  },
  infoBoxTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  infoBoxText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  bottomBar: {
    padding: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
