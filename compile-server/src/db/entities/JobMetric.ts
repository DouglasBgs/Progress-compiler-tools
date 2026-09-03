import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity()
export class JobMetric {
    @PrimaryGeneratedColumn()
    id!: number;

    @Index()
    @Column({ type: 'varchar' })
    jobId!: string;

    @Column({ type: 'varchar' })
    status!: string;

    @Column({ type: 'varchar', nullable: true })
    machineName!: string | null;

    @Column({ type: 'varchar', nullable: true })
    ip!: string | null;

    @Column({ type: 'int', default: 0 })
    filesCount!: number;

    @Column({ type: 'int', default: 0 })
    ablSourcesCount!: number;

    @Column({ type: 'varchar' })
    dbType!: string;

    @Column({ type: 'varchar', nullable: true })
    repository!: string | null;

    @Column({ type: 'int', nullable: true })
    compiledCount!: number | null;

    @Column({ type: 'int', nullable: true })
    errorsCount!: number | null;

    @Column({ type: 'text', nullable: true })
    errorMsg!: string | null;

    @Column({ type: 'int', nullable: true })
    durationMs!: number | null;

    @CreateDateColumn()
    createdAt!: Date;

    @Column({ type: 'datetime', nullable: true })
    finishedAt!: Date | null;
}
