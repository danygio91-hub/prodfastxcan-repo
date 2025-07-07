"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";

export interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

const DashboardItem = React.forwardRef<HTMLDivElement, DashboardItemProps & React.HTMLAttributes<HTMLDivElement>>(
  ({ title, description, icon: Icon, href, className, onClick, ...rest }, ref) => {
    
    const cardClasses = cn(
        "hover:shadow-lg transition-shadow duration-300 h-full flex flex-col group",
        { 'cursor-pointer': !!href || !!onClick },
        className
    );

    const cardContent = (
        <>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <Icon className="h-10 w-10 text-primary" />
                {(href || onClick) && (
                  <div className="text-muted-foreground group-hover:text-primary transition-colors">
                    <ArrowRight className="h-5 w-5" />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-grow">
              <CardTitle className="text-xl font-headline mb-1">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardContent>
        </>
    );

    if (href) {
      return (
        <Link href={href} className="block h-full" {...rest}>
          <Card ref={ref} className={cardClasses}>
            {cardContent}
          </Card>
        </Link>
      );
    }
    
    return (
      <Card ref={ref} className={cardClasses} onClick={onClick} {...rest}>
        {cardContent}
      </Card>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
