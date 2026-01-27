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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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
  owner: '#9C27B0', // Purple for owner
};

interface AdminAccount {
  id: string;
  email: string;
  company_name: string;
  contact_name: string;
  created_at: string;
  is_active: boolean;
}

export default function OwnerPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form state for new admin
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  
  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  // Owner master password (in production, this would be more secure)
  const OWNER_PASSWORD = 'BlueviewOwner2025!';

  const handleOwnerLogin = () => {
    if (ownerPassword === OWNER_PASSWORD) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setIsAuthenticated(true);
      fetchAdmins();
    } else {
      Alert.alert('Access Denied', 'Invalid owner credentials');
    }
  };

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/owner/admins`);
      if (response.ok) {
        const data = await response.json();
        setAdmins(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.log('Error fetching admins:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async () => {
    if (!newEmail || !newPassword || !newCompanyName || !newContactName) {
      Alert.alert('Required', 'Please fill in all fields');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/owner/create-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          company_name: newCompanyName,
          contact_name: newContactName,
          owner_key: OWNER_PASSWORD,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create admin');
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      Alert.alert('Success', `Admin account created for ${newCompanyName}\n\nCredentials:\nEmail: ${newEmail}\nPassword: ${newPassword}`);
      
      // Reset form
      setNewEmail('');
      setNewPassword('');
      setNewCompanyName('');
      setNewContactName('');
      setShowCreateModal(false);
      fetchAdmins();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAdmin = async (adminId: string, companyName: string) => {
  const message = `Are you sure you want to delete the admin account for ${companyName}? This will remove all their data.`;

  // Helper function to perform the actual deletion logic
  const performDelete = async () => {
    try {
      const response = await fetch(`${API_URL}/api/owner/admins/${adminId}?owner_key=${OWNER_PASSWORD}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        fetchAdmins(); // Refresh the list after successful deletion
      } else {
        const errorData = await response.json();
        Alert.alert('Error', errorData.detail || 'Failed to delete admin');
      }
    } catch (error) {
      console.log('Error deleting admin:', error);
      if (Platform.OS !== 'web') {
        Alert.alert('Error', 'Network error. Failed to delete admin.');
      }
    }
  };

  // Platform-specific confirmation logic
  if (Platform.OS === 'web') {
    // Browser confirmation
    if (window.confirm(message)) {
      await performDelete();
    }
  } else {
    // Native Mobile Alert
    Alert.alert(
      'Delete Admin Account',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: performDelete 
        },
      ]
    );
  }
};

  // Owner login screen
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.loginContainer}>
          <View style={styles.ownerBadge}>
            <Ionicons name="shield-checkmark" size={60} color={COLORS.owner} />
          </View>
          <Text style={styles.ownerTitle}>Owner Portal</Text>
          <Text style={styles.ownerSubtitle}>Blueview Service Administration</Text>
          
          <View style={styles.inputContainer}>
            <Ionicons name="key" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={ownerPassword}
              onChangeText={setOwnerPassword}
              placeholder="Owner Password"
              placeholderTextColor={COLORS.textSecondary}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          
          <TouchableOpacity style={styles.loginButton} onPress={handleOwnerLogin}>
            <Text style={styles.loginButtonText}>Access Portal</Text>
          </TouchableOpacity>
          
          <Text style={styles.disclaimer}>
            This portal is for Blueview service owners only.{'\n'}
            Unauthorized access is prohibited.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Owner dashboard
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.ownerBadgeSmall]}>
            <Ionicons name="shield-checkmark" size={24} color={COLORS.owner} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Owner Portal</Text>
            <Text style={styles.headerSubtitle}>Service Administration</Text>
          </View>
        </View>
        <TouchableOpacity 
          style={styles.logoutButton}
          onPress={() => {
            setIsAuthenticated(false);
            setOwnerPassword('');
          }}
        >
          <Ionicons name="log-out-outline" size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="business" size={28} color={COLORS.primary} />
            <Text style={styles.statValue}>{admins.length}</Text>
            <Text style={styles.statLabel}>Companies</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="checkmark-circle" size={28} color={COLORS.success} />
            <Text style={styles.statValue}>{admins.filter(a => a.is_active !== false).length}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
        </View>

        {/* Create Admin Button */}
        <TouchableOpacity 
          style={styles.createButton}
          onPress={() => setShowCreateModal(true)}
        >
          <Ionicons name="add-circle" size={24} color={COLORS.text} />
          <Text style={styles.createButtonText}>Create New Admin Account</Text>
        </TouchableOpacity>

        {/* Admin List */}
        <Text style={styles.sectionTitle}>Admin Accounts (Companies)</Text>
        
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} />
        ) : admins.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={48} color={COLORS.border} />
            <Text style={styles.emptyText}>No admin accounts yet</Text>
            <Text style={styles.emptySubtext}>Create an admin account for each paying company</Text>
          </View>
        ) : (
          admins.map((admin) => (
            <View key={admin.id} style={styles.adminCard}>
              <View style={styles.adminHeader}>
                <View style={styles.adminIcon}>
                  <Ionicons name="business" size={24} color={COLORS.primary} />
                </View>
                <View style={styles.adminInfo}>
                  <Text style={styles.adminCompany}>{admin.company_name}</Text>
                  <Text style={styles.adminContact}>{admin.contact_name}</Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDeleteAdmin(admin.id, admin.company_name)}
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
              <View style={styles.adminDetails}>
                <View style={styles.detailRow}>
                  <Ionicons name="mail-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.detailText}>{admin.email}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.detailText}>
                    Created: {new Date(admin.created_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: admin.is_active !== false ? COLORS.success + '20' : COLORS.danger + '20' }]}>
                <Text style={[styles.statusText, { color: admin.is_active !== false ? COLORS.success : COLORS.danger }]}>
                  {admin.is_active !== false ? 'ACTIVE' : 'INACTIVE'}
                </Text>
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Create Admin Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Admin Account</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.formScroll}>
              <Text style={styles.formDescription}>
                Create an admin account for a new paying company. They will use these credentials to log in and manage their subcontractors, workers, and reports.
              </Text>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Company Name *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newCompanyName}
                  onChangeText={setNewCompanyName}
                  placeholder="ABC Construction LLC"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Contact Name *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newContactName}
                  onChangeText={setNewContactName}
                  placeholder="John Smith"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Login Email *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newEmail}
                  onChangeText={setNewEmail}
                  placeholder="admin@company.com"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Password *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Create a secure password"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <Text style={styles.hint}>Share these credentials with the company admin</Text>
              </View>

              <TouchableOpacity
                style={[styles.submitButton, saving && styles.buttonDisabled]}
                onPress={handleCreateAdmin}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.text} />
                ) : (
                  <Text style={styles.submitButtonText}>Create Admin Account</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
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
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  ownerBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.owner + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  ownerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  ownerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    width: '100%',
    maxWidth: 400,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  loginButton: {
    backgroundColor: COLORS.owner,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  disclaimer: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.owner + '10',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownerBadgeSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.owner + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.owner,
  },
  logoutButton: {
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
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.owner,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 10,
    marginBottom: 24,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  adminCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  adminHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminInfo: {
    flex: 1,
    marginLeft: 12,
  },
  adminCompany: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  adminContact: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  deleteBtn: {
    padding: 8,
  },
  adminDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  detailText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  formScroll: {
    padding: 20,
  },
  formDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
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
  formInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
  },
  submitButton: {
    backgroundColor: COLORS.owner,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 40,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
