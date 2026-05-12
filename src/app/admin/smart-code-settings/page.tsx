
"use client";

import React, { useState, useEffect } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { 
  Combine, Save, Plus, Trash2, GripVertical, Settings2, 
  ChevronRight, Info, AlertCircle, CheckCircle2, Loader2, LockKeyhole
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/hooks/use-toast";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { getGlobalSettings, updateGlobalSettings } from '@/lib/settings-actions';
import { GlobalSettings, SmartCodeField, SmartCodeSettings } from '@/lib/settings-types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export default function SmartCodeSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    getGlobalSettings().then(res => {
      if (res) {
        // Ensure smartCodeSettings exists
        if (!res.smartCodeSettings) {
          res.smartCodeSettings = {
            enabled: false,
            fields: [],
            pattern: [],
            separator: '-',
          };
        }
        setSettings(res);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      // Sanitize fields: remove empty options
      const sanitizedFields = settings.smartCodeSettings!.fields.map(f => ({
        ...f,
        options: f.options.filter(opt => opt.label.trim() !== '' && opt.code.trim() !== '')
      }));

      const sanitizedSettings = {
        ...settings,
        smartCodeSettings: {
          ...settings.smartCodeSettings!,
          fields: sanitizedFields
        }
      };

      const res = await updateGlobalSettings(sanitizedSettings, "admin");
      if (res.success) {
        toast({ title: "Impostazioni salvate", description: "Le regole della Commessa Rapida sono state aggiornate." });
      } else {
        toast({ variant: "destructive", title: "Errore", description: res.message });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Errore", description: "Impossibile salvare le impostazioni." });
    } finally {
      setSaving(false);
    }
  };

  const updateSmartSettings = (update: Partial<SmartCodeSettings>) => {
    if (!settings) return;
    setSettings({
      ...settings,
      smartCodeSettings: {
        ...settings.smartCodeSettings!,
        ...update
      }
    });
  };

  const addField = () => {
    if (!settings?.smartCodeSettings) return;
    const newField: SmartCodeField = {
      id: Math.random().toString(36).substring(2, 9),
      name: "Nuovo Campo",
      type: 'dropdown',
      options: []
    };
    updateSmartSettings({
      fields: [...settings.smartCodeSettings.fields, newField]
    });
  };

  const removeField = (id: string) => {
    if (!settings?.smartCodeSettings) return;
    updateSmartSettings({
      fields: settings.smartCodeSettings.fields.filter(f => f.id !== id),
      pattern: settings.smartCodeSettings.pattern.filter(pid => pid !== id)
    });
  };

  const updateField = (id: string, update: Partial<SmartCodeField>) => {
    if (!settings?.smartCodeSettings) return;
    updateSmartSettings({
      fields: settings.smartCodeSettings.fields.map(f => f.id === id ? { ...f, ...update } : f)
    });
  };

  const addOption = (fieldId: string) => {
    if (!settings?.smartCodeSettings) return;
    const field = settings.smartCodeSettings.fields.find(f => f.id === fieldId);
    if (!field) return;
    updateField(fieldId, {
      options: [...field.options, { label: "Descrizione", code: "SIGLA" }]
    });
  };

  const removeOption = (fieldId: string, index: number) => {
    if (!settings?.smartCodeSettings) return;
    const field = settings.smartCodeSettings.fields.find(f => f.id === fieldId);
    if (!field) return;
    const newOptions = [...field.options];
    newOptions.splice(index, 1);
    updateField(fieldId, { options: newOptions });
  };

  const updateOption = (fieldId: string, index: number, update: { label?: string, code?: string }) => {
    if (!settings?.smartCodeSettings) return;
    const field = settings.smartCodeSettings.fields.find(f => f.id === fieldId);
    if (!field) return;
    const newOptions = [...field.options];
    newOptions[index] = { ...newOptions[index], ...update };
    updateField(fieldId, { options: newOptions });
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !settings?.smartCodeSettings) return;
    
    const items = Array.from(settings.smartCodeSettings.pattern);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    updateSmartSettings({ pattern: items });
  };

  const toggleInPattern = (fieldId: string) => {
    if (!settings?.smartCodeSettings) return;
    const isInPattern = settings.smartCodeSettings.pattern.includes(fieldId);
    if (isInPattern) {
      updateSmartSettings({
        pattern: settings.smartCodeSettings.pattern.filter(id => id !== fieldId)
      });
    } else {
      updateSmartSettings({
        pattern: [...settings.smartCodeSettings.pattern, fieldId]
      });
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  const smart = settings?.smartCodeSettings!;

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="max-w-5xl mx-auto space-y-8 pb-20">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Combine className="h-8 w-8 text-primary" />
                Configurazione Commessa Rapida
              </h1>
              <p className="text-muted-foreground">
                Definisci le regole per la generazione automatica dei codici articolo parlanti.
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full md:w-auto gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salva Configurazione
            </Button>
          </header>

          <Card className="border-primary/20 bg-primary/5 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-lg font-semibold">Attiva Sistema Commessa Rapida</Label>
                  <p className="text-sm text-muted-foreground">Abilita il pulsante "+ Commessa Rapida" nella gestione dati.</p>
                </div>
                <Switch 
                  checked={smart.enabled} 
                  onCheckedChange={(checked) => updateSmartSettings({ enabled: checked })} 
                  className="scale-125"
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-xl">1. Campi Dinamici (Custom Fields)</CardTitle>
                    <CardDescription>Crea i parametri che comporranno il codice articolo.</CardDescription>
                  </div>
                  <Button onClick={addField} variant="outline" size="sm" className="gap-2">
                    <Plus className="h-4 w-4" /> Aggiungi Campo
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  {smart.fields.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg text-muted-foreground">
                      <Settings2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      Nessun campo configurato. Clicca su "Aggiungi Campo" per iniziare.
                    </div>
                  )}

                  {smart.fields.map((field) => (
                    <div key={field.id} className="p-4 border rounded-xl space-y-4 bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-[10px] uppercase font-bold text-primary/70 ml-1">Nome del Campo</Label>
                          <Input 
                            value={field.name} 
                            onChange={(e) => updateField(field.id, { name: e.target.value })}
                            className="font-bold text-lg h-10 bg-background"
                            placeholder="Es. Sezione, Lunghezza..."
                          />
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <Tabs 
                            value={field.type} 
                            onValueChange={(v) => updateField(field.id, { type: v as 'dropdown' | 'text' })}
                            className="w-auto"
                          >
                            <TabsList className="grid w-[240px] grid-cols-2 h-8">
                              <TabsTrigger value="dropdown" className="text-[10px] uppercase">Menu a Tendina</TabsTrigger>
                              <TabsTrigger value="text" className="text-[10px] uppercase">Testo Libero</TabsTrigger>
                            </TabsList>
                          </Tabs>

                          <div className="flex items-center gap-2 border-l pl-4">
                            <Button 
                              size="sm" 
                              variant={smart.pattern.includes(field.id) ? "default" : "outline"}
                              onClick={() => toggleInPattern(field.id)}
                              className="h-8 text-xs"
                            >
                              {smart.pattern.includes(field.id) ? "Incluso" : "Includi"}
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => removeField(field.id)} className="h-8 w-8 text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {field.type === 'dropdown' ? (
                        <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Opzioni e Sigle</Label>
                            <span className="text-[10px] text-muted-foreground italic flex items-center gap-1">
                              <Info className="h-3 w-3" />
                              Es: Descrizione = 'Terminale a Occhiello', Sigla = 'TE'
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {field.options.map((opt, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-background p-2 rounded-lg border shadow-sm">
                                <Input 
                                  value={opt.label} 
                                  onChange={(e) => updateOption(field.id, idx, { label: e.target.value })}
                                  className="h-8 text-xs flex-[2]"
                                  placeholder="Descrizione (nel menu)"
                                />
                                <Input 
                                  value={opt.code} 
                                  onChange={(e) => updateOption(field.id, idx, { code: e.target.value })}
                                  className="h-8 text-xs font-mono flex-1 uppercase"
                                  placeholder="Sigla (nel codice)"
                                />
                                <Button size="icon" variant="ghost" onClick={() => removeOption(field.id, idx)} className="h-8 w-8 text-muted-foreground">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => addOption(field.id)}
                              className="h-9 border border-dashed hover:border-primary hover:text-primary transition-all rounded-lg gap-2 text-xs"
                            >
                              <Plus className="h-3 w-3" /> Aggiungi Valore
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="pl-4 border-l-2 border-primary/20 py-2">
                          <p className="text-xs text-muted-foreground flex items-center gap-2">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            Questo campo accetterà input libero nel modale operativo.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="sticky top-8">
                <CardHeader>
                  <CardTitle className="text-xl">2. Pattern del Codice</CardTitle>
                  <CardDescription>Trascina i campi per definire la sequenza del Codice Parlante.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Separatore</Label>
                    <div className="flex gap-2 flex-wrap">
                      {['-', '.', '_', '/', 'Nessuno'].map((sep) => (
                        <Button 
                          key={sep}
                          variant={smart.separator === (sep === 'Nessuno' ? '' : sep) ? "default" : "outline"}
                          className="flex-1 h-9"
                          size="sm"
                          onClick={() => updateSmartSettings({ separator: sep === 'Nessuno' ? '' : sep })}
                        >
                          {sep}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label>Sequenza Attiva</Label>
                    
                    <div className="space-y-2">
                      {/* Fixed Client Prefix */}
                      <div className="flex items-center gap-3 p-3 bg-muted border-2 border-dashed rounded-lg opacity-70">
                        <LockKeyhole size={16} className="text-muted-foreground" />
                        <span className="text-sm font-semibold italic">PREFISSO CLIENTE (AUTO)</span>
                        <Badge variant="secondary" className="ml-auto">FISSO</Badge>
                      </div>

                      <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="pattern">
                          {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                              {smart.pattern.map((fieldId, index) => {
                                const field = smart.fields.find(f => f.id === fieldId);
                                if (!field) return null;
                                return (
                                  <Draggable key={fieldId} draggableId={fieldId} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={cn(
                                          "flex items-center gap-3 p-3 bg-card border rounded-lg shadow-sm transition-all",
                                          snapshot.isDragging && "ring-2 ring-primary ring-offset-2 scale-105 z-50 shadow-xl"
                                        )}
                                      >
                                        <GripVertical size={16} className="text-muted-foreground" />
                                        <span className="text-sm font-bold uppercase">{field.name}</span>
                                        <div className="ml-auto flex items-center gap-2">
                                          <Badge variant="outline" className="text-[10px] uppercase">#{index + 1}</Badge>
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                );
                              })}
                              {provided.placeholder}
                            </div>
                          )}
                        </Droppable>
                      </DragDropContext>
                    </div>

                    {smart.pattern.length === 0 && (
                      <p className="text-xs text-amber-600 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        Nessun campo dinamico incluso nel pattern. Verrà usato solo il prefisso cliente.
                      </p>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <Label className="text-xs uppercase font-bold text-muted-foreground tracking-widest">Esempio Preview</Label>
                    <div className="p-4 bg-slate-900 rounded-xl border-t-4 border-primary shadow-inner">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-primary/60 font-mono uppercase">Codice Generato</span>
                        <span className="text-lg font-mono font-bold text-white tracking-wider">
                          ZU{smart.separator}
                          {smart.pattern.map((pid, i) => {
                            const f = smart.fields.find(field => field.id === pid);
                            return (
                              <React.Fragment key={pid}>
                                <span className="text-primary-foreground underline decoration-primary/40 underline-offset-4">
                                  {f?.type === 'text' ? `[${f.name.toUpperCase()}]` : (f?.options[0]?.code || "???")}
                                </span>
                                {i < smart.pattern.length - 1 ? smart.separator : ""}
                              </React.Fragment>
                            );
                          })}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">
                      * ZU è l'esempio di prefisso per il cliente "ZUCCHINI".
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}

