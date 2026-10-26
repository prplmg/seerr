import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class LetterboxdExportBaseline {
  @PrimaryColumn({ type: 'integer' }) userId: number;
  @Column({ type: 'varchar' }) account: string;
  @Column({ type: 'text' }) value: string;
}

@Entity()
export class LetterboxdExportAudit {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ type: 'integer' }) userId: number;
  @Column({ type: 'varchar' }) account: string;
  @Column({ type: 'varchar' }) revision: string;
  @Column({ type: 'varchar' }) capturedAt: string;
  @Column({ type: 'integer' }) changes: number;
}
