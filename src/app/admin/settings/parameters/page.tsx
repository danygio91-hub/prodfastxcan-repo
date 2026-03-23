
"use client";

import React, { useState, useEffect } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Plus, Trash2, Settings2, Boxes, Ruler, AlertCircle, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { getGlobalSettings, updateGlobalSettings } from '@/lib/settings-actions';
import { GlobalSettings, RawMaterialTypeConfig } from '@/lib/settings-types';

export default function GlobalParametersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getGlobalSettings().then(setSettings).finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings || !user) return;
    setIsSaving(true);
    const res = await updateGlobalSettings(settings, user.uid);
    if (res.success) {
      toast({ title: 'Impostazioni salvate', description: 'I parametri globali sono stati aggiornati.' });
    } else {
      toast({ variant: 'destructive', title: 'Errore', description: res.message });
    }
    setIsSaving(false);
  };

  const addRawMaterialType = () => {
    if (!settings) return;
    const newType: RawMaterialTypeConfig = {
      id: `NEW_${Date.now()}`,
      label: 'Nuova Tipologia',
      defaultUnit: 'mt',
      hasConversion: false
    };
    setSettings({ ...settings, rawMaterialTypes: [...settings.rawMaterialTypes, newType] });
  };

  const updateRawMaterialType = (index: number, updates: Partial<RawMaterialTypeConfig>) => {
    if (!settings) return;
    const newTypes = [...settings.rawMaterialTypes];
    newTypes[index] = { ...newTypes[index], ...updates };
    setSettings({ ...settings, rawMaterialTypes: newTypes });
  };

  const removeRawMaterialType = (index: number) => {
    if (!settings) return;
    const newTypes = settings.rawMaterialTypes.filter((_, i) => i !== index);
    setSettings({ ...settings, rawMaterialTypes: newTypes });
  };

  const addListItem = (key: keyof Pick<GlobalSettings, 'unitsOfMeasure' | 'materialSessionCategories'>) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: [...settings[key] as string[], ''] });
  };

  const updateListItem = (key: keyof Pick<GlobalSettings, 'unitsOfMeasure' | 'materialSessionCategories'>, index: number, value: string) => {
    if (!settings) return;
    const newList = [...settings[key] as string[]];
    newList[index] = value;
    setSettings({ ...settings, [key]: newList });
  };

  const removeListItem = (key: keyof Pick<GlobalSettings, 'unitsOfMeasure' | 'materialSessionCategories'>, index: number) => {
    if (!settings) return;
    const newList = (settings[key] as string[]).filter((_, i) => i !== index);
    setSettings({ ...settings, [key]: newList });
  };

  const addProblemType = () => {
    if (!settings) return;
    setSettings({ 
      ...settings, 
      productionProblemTypes: [...settings.productionProblemTypes, { id: `PROB_${Date.now()}`, label: 'Nuovo Problema' }] 
    });
  };

  const updateProblemType = (index: number, label: string) => {
    if (!settings) return;
    const newList = [...settings.productionProblemTypes];
    newList[index] = { ...newList[index], label, id: label.toUpperCase().replace(/\s+/g, '_') };
    setSettings({ ...settings, productionProblemTypes: newList });
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex justify-center items-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!settings) return null;

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <header className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Settings2 className="h-8 w-8 text-primary" />
                Parametri Globali
              </h1>
              <p className="text-muted-foreground">Configura le tipologie, le unità di misura e i parametri di sistema dell'officina.</p>
            </div>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salva Tutto
            </Button>
          </header>

          <Tabs defaultValue="materials" className="w-full">
            <TabsList className="grid w-full grid-cols-4 max-w-2xl">
              <TabsTrigger value="materials" className="gap-2"><Boxes className="h-4 w-4" /> Materiali</TabsTrigger>
              <TabsTrigger value="units" className="gap-2"><Ruler className="h-4 w-4" /> Unità</TabsTrigger>
              <TabsTrigger value="problems" className="gap-2"><AlertCircle className="h-4 w-4" /> Problemi</TabsTrigger>
              <TabsTrigger value="sessions" className="gap-2"><Layers className="h-4 w-4" /> Sessioni</TabsTrigger>
            </TabsList>

            {/* RAW MATERIAL TYPES */}
            <TabsContent value="materials" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Tipologie Materie Prime</CardTitle>
                    <CardDescription>Definisci i tipi di materiale (es. BOB, TUBI) e le loro logiche di default.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={addRawMaterialType} className="gap-1">
                    <Plus className="h-4 w-4" /> Aggiungi Tipo
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  {settings.rawMaterialTypes.map((type, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border rounded-lg bg-muted/5 relative group">
                      <div className="space-y-2">
                        <Label>Codice/ID</Label>
                        <Input value={type.id} onChange={(e) => updateRawMaterialType(index, { id: e.target.value.toUpperCase() })} placeholder="Es. BOB" />
                      </div>
                      <div className="space-y-2">
                        <Label>Etichetta</Label>
                        <Input value={type.label} onChange={(e) => updateRawMaterialType(index, { label: e.target.value })} placeholder="Es. Bobina" />
                      </div>
                      <div className="space-y-2">
                        <Label>Unità Default</Label>
                        <Select value={type.defaultUnit} onValueChange={(val: any) => updateRawMaterialType(index, { defaultUnit: val })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {settings.unitsOfMeasure.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col justify-end space-y-4 pb-1">
                         <div className="flex items-center justify-between gap-2 px-1">
                            <Label className="text-xs">Usa Conversione</Label>
                            <Switch checked={type.hasConversion} onCheckedChange={(val) => updateRawMaterialType(index, { hasConversion: val })} />
                         </div>
                         {type.hasConversion && (
                            <Select value={type.conversionType} onValueChange={(val: any) => updateRawMaterialType(index, { conversionType: val })}>
                                <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Tipo conv." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="kg/mt">Peso specifico (KG/MT)</SelectItem>
                                    <SelectItem value="kg/unit">Peso unitario (KG/PZ)</SelectItem>
                                </SelectContent>
                            </Select>
                         )}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeRawMaterialType(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* UNITS OF MEASURE */}
            <TabsContent value="units" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Unità di Misura</CardTitle>
                    <CardDescription>Definisci le unità utilizzabili a sistema.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => addListItem('unitsOfMeasure')} className="gap-1">
                    <Plus className="h-4 w-4" /> Aggiungi Unità
                  </Button>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {settings.unitsOfMeasure.map((unit, index) => (
                            <div key={index} className="flex gap-2">
                                <Input value={unit} onChange={(e) => updateListItem('unitsOfMeasure', index, e.target.value.toLowerCase())} placeholder="es. cm" />
                                <Button variant="ghost" size="icon" onClick={() => removeListItem('unitsOfMeasure', index)} className="text-destructive shrink-0">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* PROBLEM TYPES */}
            <TabsContent value="problems" className="space-y-4 pt-4">
               <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Tipi di Problemi</CardTitle>
                    <CardDescription>Personalizza i motivi di segnalazione problemi in produzione.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={addProblemType} className="gap-1">
                    <Plus className="h-4 w-4" /> Aggiungi Motivo
                  </Button>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {settings.productionProblemTypes.map((prob, index) => (
                        <div key={index} className="flex gap-2 p-2 border rounded items-center">
                            <div className="flex-1 space-y-1">
                                <Label className="text-[10px] uppercase text-muted-foreground">ID: {prob.id}</Label>
                                <Input value={prob.label} onChange={(e) => updateProblemType(index, e.target.value)} />
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => {
                                const newList = settings.productionProblemTypes.filter((_, i) => i !== index);
                                setSettings({ ...settings, productionProblemTypes: newList });
                            }} className="text-destructive mt-4">
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* MATERIAL SESSION CATEGORIES */}
            <TabsContent value="sessions" className="space-y-4 pt-4">
                <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Categorie Sessioni Materiale</CardTitle>
                    <CardDescription>Raggruppamenti per la gestione dei carichi attivi dei materiali.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => addListItem('materialSessionCategories')} className="gap-1">
                    <Plus className="h-4 w-4" /> Aggiungi Categoria
                  </Button>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {settings.materialSessionCategories.map((cat, index) => (
                            <div key={index} className="flex gap-2">
                                <Input value={cat} onChange={(e) => updateListItem('materialSessionCategories', index, e.target.value.toUpperCase())} />
                                <Button variant="ghost" size="icon" onClick={() => removeListItem('materialSessionCategories', index)} className="text-destructive shrink-0">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
