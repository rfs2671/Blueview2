import React, { useState, useEffect, useRef } from 'react';
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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import { api } from '../../src/utils/api';
import SignaturePad from '../../src/components/SignaturePad';

interface Worker {
  id: string;
  name: string;
  trade: string;
  company: string;
  osha_number?: string;
  certifications: string[];
  signature?: string;
}

export default function WorkerDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    trade: '',
    company: '',
    osha_number: '',
  });

  useEffect(() => {
    fetchWorker();
  }, [id]);

  const fetchWorker = async () => {
    try {
      const data = await api.getWorker(id as string);
      setWorker(data);
      setFormData({
        name: data.name,
        trade: data.trade,
        company: data.company,
        osha_number: data.osha_number || '',
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to load worker details');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.trade || !formData.company.trim()) {
      Alert.alert('Required', 'Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      await api.updateWorker(id as string, formData);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setIsEditing(false);
      fetchWorker();
    } catch (error) {
      Alert.alert('Error', 'Failed to update worker');
    } finally {
      setSaving(false);
    }
  };

  const handleSignatureSave = async (signature: string) => {
    try {
      await api.updateWorker(id as string, { signature });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setShowSignaturePad(false);
      fetchWorker();
    } catch (error) {
      Alert.alert('Error', 'Failed to save signature');
    }
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

  if (!worker) {
    return null;
  }

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
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Worker Passport</Text>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => {
              if (isEditing) {
                handleSave();
              } else {
                setIsEditing(true);
              }
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <Ionicons
                name={isEditing ? 'checkmark' : 'create-outline'}
                size={24}
                color={COLORS.text}
              />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Worker Avatar */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarLarge}>
              <Text style={styles.avatarTextLarge}>
                {worker.name.split(' ').map((n) => n[0]).join('').toUpperCase()}
              </Text>
            </View>
            {worker.signature && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="shield-checkmark" size={16} color={COLORS.text} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
          </View>

          {/* Worker Info */}
          <View style={styles.infoSection}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Full Name</Text>
              {isEditing ? (
                <TextInput
                  style={styles.infoInput}
                  value={formData.name}
                  onChangeText={(text) =>
                    setFormData({ ...formData, name: text })
                  }
                />
              ) : (
                <Text style={styles.infoValue}>{worker.name}</Text>
              )}
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Trade</Text>
              {isEditing ? (
                <TextInput
                  style={styles.infoInput}
                  value={formData.trade}
                  onChangeText={(text) =>
                    setFormData({ ...formData, trade: text })
                  }
                />
              ) : (
                <Text style={styles.infoValue}>{worker.trade}</Text>
              )}
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Company</Text>
              {isEditing ? (
                <TextInput
                  style={styles.infoInput}
                  value={formData.company}
                  onChangeText={(text) =>
                    setFormData({ ...formData, company: text })
                  }
                />
              ) : (
                <Text style={styles.infoValue}>{worker.company}</Text>
              )}
            </View>
          </View>

          {/* Certifications */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            <View style={styles.certList}>
              {worker.certifications.length > 0 ? (
                worker.certifications.map((cert) => (
                  <View key={cert} style={styles.certBadge}>
                    <Ionicons
                      name="ribbon"
                      size={14}
                      color={COLORS.success}
                    />
                    <Text style={styles.certText}>{cert}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noCerts}>No certifications added</Text>
              )}
            </View>
          </View>

          {/* Digital Signature */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Digital Signature</Text>
            {worker.signature ? (
              <View style={styles.signatureContainer}>
                <Image
                  source={{ uri: worker.signature }}
                  style={styles.signatureImage}
                  resizeMode="contain"
                />
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
                <Ionicons name="create" size={24} color={COLORS.primary} />
                <Text style={styles.addSignatureText}>Add Digital Signature</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  editButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarLarge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarTextLarge: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.text,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 12,
    gap: 6,
  },
  verifiedText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  infoSection: {
    marginBottom: 20,
  },
  infoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  infoInput: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primary,
    paddingVertical: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  certList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  certBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  certText: {
    fontSize: 14,
    color: COLORS.text,
  },
  noCerts: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  signatureContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  signatureImage: {
    width: '100%',
    height: 120,
    backgroundColor: COLORS.text,
    borderRadius: 8,
  },
  updateSignatureButton: {
    marginTop: 12,
  },
  updateSignatureText: {
    fontSize: 14,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  addSignatureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    gap: 10,
  },
  addSignatureText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
});
